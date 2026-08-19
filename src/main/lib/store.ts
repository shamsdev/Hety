import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppData, emptyAppData } from '@shared/types'
import * as vault from './crypto'

let dataPath = ''
let current: AppData = emptyAppData()
let password: string | null = null
let encrypted = false

/** Writes are coalesced: the renderer persists on every mutation (including card drags). */
const SAVE_DEBOUNCE_MS = 400
let saveTimer: NodeJS.Timeout | null = null
let dirty = false
/** Serialises writes so two flushes can never interleave their renames. */
let chain: Promise<void> = Promise.resolve()
/** A failure from a debounced (unawaited) write, reported on the next save call. */
let deferredError: Error | null = null

function file(): string {
  if (!dataPath) dataPath = path.join(app.getPath('userData'), 'hety-data.dat')
  return dataPath
}

/** Previous good copy, kept so a torn write is always recoverable. */
function backupFile(): string {
  return file() + '.bak'
}

function tempFile(): string {
  return file() + '.tmp'
}

export async function getStatus(): Promise<{ exists: boolean; encrypted: boolean }> {
  for (const candidate of [file(), backupFile()]) {
    try {
      const buf = await fs.readFile(candidate)
      if (!vault.hasMagic(buf)) continue
      return { exists: true, encrypted: vault.isEncrypted(buf) }
    } catch {
      // missing or unreadable — try the backup before declaring a fresh install,
      // otherwise a crash mid-swap would show the first-run screen and overwrite it.
    }
  }
  return { exists: false, encrypted: false }
}

function parse(buf: Buffer, pw: string | null): AppData {
  const plain = vault.decrypt(buf, pw ?? '')
  const data = JSON.parse(plain.toString('utf8')) as AppData
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    throw new Error('Data file is not valid Hety data.')
  }
  return data
}

export async function unlock(pw: string | null): Promise<AppData> {
  let firstError: Error | null = null

  for (const candidate of [file(), backupFile()]) {
    try {
      const buf = await fs.readFile(candidate)
      const data = parse(buf, pw)
      current = data
      encrypted = vault.isEncrypted(buf)
      password = encrypted ? pw : null
      if (candidate !== file()) {
        // Recovered from the backup — put it back in place before anything else runs.
        dirty = true
        await flush()
      }
      return current
    } catch (e) {
      firstError ??= e as Error
    }
  }

  throw firstError ?? new Error('No data file found.')
}

export async function create(pw: string | null): Promise<AppData> {
  current = emptyAppData()
  password = pw && pw.length ? pw : null
  encrypted = !!password
  dirty = true
  await flush()
  return current
}

export function getData(): AppData {
  return current
}

export async function save(data: AppData): Promise<void> {
  current = data
  dirty = true
  scheduleFlush()
  if (deferredError) {
    const e = deferredError
    deferredError = null
    throw e
  }
}

export async function setEncryption(enabled: boolean, pw: string | null): Promise<void> {
  encrypted = enabled
  password = enabled ? pw : null
  dirty = true
  await flush()
}

function scheduleFlush(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flush().catch((e: Error) => {
      deferredError = e
    })
  }, SAVE_DEBOUNCE_MS)
}

/** True when a save is still buffered — used to hold the app open until it lands. */
export function hasPendingWrite(): boolean {
  return dirty || saveTimer !== null
}

/** Write any buffered changes now and resolve once they are on disk. */
export function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!dirty) return chain.catch(() => undefined)

  dirty = false
  const snapshot = current
  const pw = password
  const enc = encrypted

  const next = chain.catch(() => undefined).then(() => write(snapshot, enc, pw))
  chain = next.catch(() => undefined)
  return next
}

async function write(data: AppData, enc: boolean, pw: string | null): Promise<void> {
  const plain = Buffer.from(JSON.stringify(data), 'utf8')
  const out = enc && pw ? vault.encrypt(plain, pw) : vault.packPlain(plain)

  await fs.mkdir(path.dirname(file()), { recursive: true })

  // Write the whole payload to a temp file and fsync it, so the bytes are durable
  // before anything touches the real file.
  const tmp = tempFile()
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(out)
    await handle.sync()
  } finally {
    await handle.close()
  }

  // Then swap it in with two atomic renames. A crash between them leaves the data
  // in the backup, which `unlock` and `getStatus` fall back to.
  try {
    await fs.rename(file(), backupFile())
  } catch {
    // first write — nothing to keep
  }
  await fs.rename(tmp, file())
}

export function dataFilePath(): string {
  return file()
}
