/**
 * Pure text → data helpers for the Remote tab. Everything here turns raw
 * command output (ls, ps, df, ufw, ss, systemctl, docker…) into typed records,
 * with no IO of its own, so it can be exercised without a live host.
 */
import type {
  AuditItem,
  CpuCore,
  DiskUsage,
  DockerContainer,
  DockerImage,
  Fail2banJail,
  ListeningPort,
  LoginRecord,
  NetInterface,
  ProcessInfo,
  RemoteEntry,
  RemoteEntryType,
  ServiceUnit,
  UfwRule,
  UfwStatus
} from '@shared/types'

// ------------------------------------------------------------------ shell bits

/** Single-quote a value for safe interpolation into a remote shell command. */
export function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Wrap a multi-command script so it can be handed to `sudo` as one unit. */
export function asScript(script: string): string {
  return `sh -c ${q(script)}`
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx)
}

/** Split `@@marker`-delimited script output into named blocks. */
export function sections(output: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let current = ''
  for (const line of output.split('\n')) {
    const m = /^@@(\w+)\s*$/.exec(line)
    if (m) {
      current = m[1]
      out[current] = []
      continue
    }
    if (current) out[current].push(line)
  }
  return out
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx < 0 ? trimmed : trimmed.slice(idx + 1)
}

// ----------------------------------------------------------------- file system

export function modeToText(mode: number): string {
  const bits = 'rwxrwxrwx'
  let out = ''
  for (let i = 0; i < 9; i++) {
    out += mode & (1 << (8 - i)) ? bits[i] : '-'
  }
  return out
}

export function typeFromMode(mode: number): RemoteEntryType {
  const fmt = mode & 0o170000
  if (fmt === 0o040000) return 'dir'
  if (fmt === 0o100000) return 'file'
  if (fmt === 0o120000) return 'link'
  return 'other'
}

/** Owner/group columns out of an `ls -l` style longname. */
export function ownerFromLongname(longname: string): { owner: string; group: string } {
  const m = /^\S+\s+\d+\s+(\S+)\s+(\S+)\s+/.exec(longname)
  return { owner: m?.[1] ?? '', group: m?.[2] ?? '' }
}

const LS_LINE = /^([-dlbcps])(\S{9})\S*\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(.*)$/

/** Parse `ls -Al --time-style=+%s` output (the sudo fallback listing). */
export function parseLsListing(output: string, dir: string): RemoteEntry[] {
  const entries: RemoteEntry[] = []
  for (const line of output.split('\n')) {
    const m = LS_LINE.exec(line.trim())
    if (!m) continue
    const [, kind, perms, owner, group, size, mtime, rest] = m
    const name = kind === 'l' ? rest.split(' -> ')[0] : rest
    if (!name || name === '.' || name === '..') continue
    entries.push({
      name,
      path: joinPath(dir, name),
      type: kind === 'd' ? 'dir' : kind === 'l' ? 'link' : kind === '-' ? 'file' : 'other',
      size: Number(size),
      mtime: Number(mtime) * 1000,
      mode: 0,
      modeText: perms,
      owner,
      group
    })
  }
  return entries
}

export function looksBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, 4096)
  if (slice.includes(0)) return true
  let weird = 0
  for (const byte of slice) {
    if (byte < 7 || (byte > 13 && byte < 32)) weird++
  }
  return weird / Math.max(1, slice.length) > 0.1
}

// ------------------------------------------------------------------ monitoring

export interface CpuSample {
  [key: string]: { total: number; idle: number }
}
export interface NetSample {
  time: number
  ifs: Record<string, { rx: number; tx: number }>
}

export function parseCpuSample(lines: string[]): CpuSample {
  const sample: CpuSample = {}
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (!parts[0]?.startsWith('cpu')) continue
    const nums = parts.slice(1, 9).map((n) => Number(n) || 0)
    const total = nums.reduce((a, b) => a + b, 0)
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0)
    sample[parts[0]] = { total, idle }
  }
  return sample
}

/** Busy percentage between two /proc/stat samples. */
export function cpuUsage(prev: CpuSample | undefined, next: CpuSample, key: string): number {
  const a = prev?.[key]
  const b = next[key]
  if (!a || !b) return 0
  const dTotal = b.total - a.total
  const dIdle = b.idle - a.idle
  if (dTotal <= 0) return 0
  return Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100))
}

export function cpuCores(prev: CpuSample | undefined, next: CpuSample): CpuCore[] {
  return Object.keys(next)
    .filter((k) => k !== 'cpu')
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
    .map((k) => ({ id: k.slice(3), usage: cpuUsage(prev, next, k) }))
}

/** /proc/meminfo keys in bytes. */
export function parseMeminfo(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines) {
    const m = /^(\w+):\s+(\d+)/.exec(line)
    if (m) out[m[1]] = Number(m[2]) * 1024
  }
  return out
}

/** `df -PkT` rows. */
export function parseDisks(lines: string[]): DiskUsage[] {
  const disks: DiskUsage[] = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 7 || parts[0] === 'Filesystem') continue
    const [filesystem, type, size, used, available, capacity, ...mountParts] = parts
    const total = Number(size) * 1024
    if (!Number.isFinite(total) || total <= 0) continue
    disks.push({
      filesystem,
      type,
      mount: mountParts.join(' '),
      size: total,
      used: Number(used) * 1024,
      available: Number(available) * 1024,
      usePercent: Number(capacity.replace('%', '')) || 0
    })
  }
  return disks
}

/** `ps -eo pid=,user=,pcpu=,pmem=,rss=,args=` rows. */
export function parseProcesses(lines: string[]): ProcessInfo[] {
  const out: ProcessInfo[] = []
  for (const line of lines) {
    const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const command = m[6].trim()
    const first = command.split(/\s+/)[0] ?? ''
    out.push({
      pid: Number(m[1]),
      user: m[2],
      cpu: Number(m[3]),
      mem: Number(m[4]),
      rss: Number(m[5]) * 1024,
      name: baseName(first.replace(/^\[|\]$/g, '')) || command,
      command
    })
  }
  return out
}

/** /proc/net/dev counters, turned into per-second rates against `prev`. */
export function parseNet(
  lines: string[],
  prev: NetSample | undefined,
  now: number
): { interfaces: NetInterface[]; sample: NetSample } {
  const sample: NetSample = { time: now, ifs: {} }
  const interfaces: NetInterface[] = []
  const elapsed = prev ? Math.max(0.001, (now - prev.time) / 1000) : 0
  for (const line of lines) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line)
    if (!m) continue
    const name = m[1].trim()
    if (name === 'lo' || name.startsWith('veth') || name.startsWith('br-')) continue
    const nums = m[2].trim().split(/\s+/).map(Number)
    const rx = nums[0] ?? 0
    const tx = nums[8] ?? 0
    sample.ifs[name] = { rx, tx }
    const before = prev?.ifs[name]
    interfaces.push({
      name,
      rxBytes: rx,
      txBytes: tx,
      rxRate: before && elapsed ? Math.max(0, (rx - before.rx) / elapsed) : 0,
      txRate: before && elapsed ? Math.max(0, (tx - before.tx) / elapsed) : 0
    })
  }
  interfaces.sort((a, b) => b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes))
  return { interfaces, sample }
}

/** `who` rows. */
export function parseWho(lines: string[]): { user: string; tty: string; from: string; since: string }[] {
  return lines
    .filter((l) => l.trim())
    .map((l) => {
      const parts = l.trim().split(/\s+/)
      const from = /\(([^)]*)\)/.exec(l)?.[1] ?? ''
      return { user: parts[0] ?? '', tty: parts[1] ?? '', from, since: parts.slice(2, 4).join(' ') }
    })
}

// -------------------------------------------------------------------- security

const UFW_RULE = /^\[\s*(\d+)\]\s+(.+?)\s{2,}([A-Z]+(?:\s+[A-Z]+)*)\s{2,}(.+?)\s*$/

export function parseUfw(lines: string[]): UfwStatus {
  const text = lines.join('\n')
  if (text.includes('NOT_INSTALLED')) {
    return { installed: false, active: false, defaults: '', logging: '', rules: [] }
  }
  const rules: UfwRule[] = []
  for (const line of lines) {
    const m = UFW_RULE.exec(line)
    if (!m) continue
    let from = m[4]
    let comment: string | undefined
    const hash = from.indexOf('#')
    if (hash >= 0) {
      comment = from.slice(hash + 1).trim()
      from = from.slice(0, hash).trim()
    }
    rules.push({ num: Number(m[1]), to: m[2].trim(), action: m[3].trim(), from, comment })
  }
  return {
    installed: true,
    active: /Status:\s*active/i.test(text),
    defaults: /Default:\s*(.+)/i.exec(text)?.[1]?.trim() ?? '',
    logging: /Logging:\s*(.+)/i.exec(text)?.[1]?.trim() ?? '',
    rules
  }
}

/** `ss -tulpnH` (preferred) or `netstat -tulpn` rows. */
export function parsePorts(lines: string[]): ListeningPort[] {
  const out: ListeningPort[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /^(Netid|Proto|Active)/i.test(trimmed)) continue
    const parts = trimmed.split(/\s+/)
    const proto = parts[0]
    if (!/^(tcp|udp)/i.test(proto)) continue
    // `ss` prints the state in column 2 and the local address in column 5;
    // `netstat` prints two numeric queue columns and the address in column 4.
    const isSs = !/^\d+$/.test(parts[1] ?? '')
    const local = isSs ? parts[4] : parts[3]
    if (!local || !local.includes(':')) continue
    const idx = local.lastIndexOf(':')
    const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(trimmed)
    const netstat = /(\d+)\/(\S+)\s*$/.exec(trimmed)
    let process = ''
    let pid: number | undefined
    if (users) {
      process = users[1]
      pid = Number(users[2])
    } else if (netstat) {
      pid = Number(netstat[1])
      process = netstat[2]
    }
    out.push({
      proto: proto.toLowerCase(),
      address: local.slice(0, idx) || '*',
      port: local.slice(idx + 1),
      process,
      pid
    })
  }
  return out.sort((a, b) => (Number(a.port) || 0) - (Number(b.port) || 0))
}

export function parseFail2ban(lines: string[]): { installed: boolean; jails: Fail2banJail[] } {
  const text = lines.join('\n')
  if (text.includes('NOT_INSTALLED') || !text.trim()) return { installed: false, jails: [] }
  const jails: Fail2banJail[] = []
  let current: Fail2banJail | null = null
  for (const line of lines) {
    const start = /^@@jail\s+(\S+)/.exec(line)
    if (start) {
      current = { name: start[1], currentlyFailed: 0, totalFailed: 0, banned: [], totalBanned: 0 }
      jails.push(current)
      continue
    }
    if (!current) continue
    const failed = /Currently failed:\s*(\d+)/.exec(line)
    if (failed) current.currentlyFailed = Number(failed[1])
    const totalFailed = /Total failed:\s*(\d+)/.exec(line)
    if (totalFailed) current.totalFailed = Number(totalFailed[1])
    const totalBanned = /Total banned:\s*(\d+)/.exec(line)
    if (totalBanned) current.totalBanned = Number(totalBanned[1])
    const banned = /Banned IP list:\s*(.*)$/.exec(line)
    if (banned) current.banned = banned[1].trim().split(/\s+/).filter(Boolean)
  }
  return { installed: true, jails }
}

interface AuditRule {
  key: string
  label: string
  good: (v: string) => boolean | null
  advice: string
}

const SSHD_AUDIT: AuditRule[] = [
  {
    key: 'permitrootlogin',
    label: 'Root login',
    good: (v) => v === 'no',
    advice: 'Set PermitRootLogin no and use a sudo-capable user.'
  },
  {
    key: 'passwordauthentication',
    label: 'Password auth',
    good: (v) => v === 'no',
    advice: 'Disable password auth once key-based login works.'
  },
  {
    key: 'permitemptypasswords',
    label: 'Empty passwords',
    good: (v) => v === 'no',
    advice: 'PermitEmptyPasswords must be no.'
  },
  {
    key: 'pubkeyauthentication',
    label: 'Public key auth',
    good: (v) => v === 'yes',
    advice: 'Enable PubkeyAuthentication for key-based login.'
  },
  {
    key: 'x11forwarding',
    label: 'X11 forwarding',
    good: (v) => v === 'no',
    advice: 'Turn X11Forwarding off unless you need remote GUI apps.'
  },
  {
    key: 'maxauthtries',
    label: 'Max auth tries',
    good: (v) => Number(v) <= 4,
    advice: 'Lower MaxAuthTries to 3–4 to slow brute forcing.'
  },
  { key: 'port', label: 'SSH port', good: () => null, advice: '' },
  {
    key: 'permittunnel',
    label: 'Tunnelling',
    good: (v) => v === 'no',
    advice: 'PermitTunnel should stay off unless VPN-over-SSH is required.'
  }
]

/** Audit the effective config printed by `sshd -T`. */
export function parseSshd(lines: string[]): AuditItem[] {
  const text = lines.join('\n')
  if (!text.trim() || text.includes('UNAVAILABLE')) return []
  const config = new Map<string, string>()
  for (const line of lines) {
    const m = /^(\w+)\s+(.*)$/.exec(line.trim())
    if (m && !config.has(m[1].toLowerCase())) config.set(m[1].toLowerCase(), m[2].trim())
  }
  const items: AuditItem[] = []
  for (const rule of SSHD_AUDIT) {
    const value = config.get(rule.key)
    if (value === undefined) continue
    const status = rule.good(value.toLowerCase())
    items.push({
      key: rule.label,
      value,
      status,
      advice: status === false ? rule.advice : undefined
    })
  }
  return items
}

/** `last` / `lastb` rows. */
export function parseLogins(lines: string[], failed: boolean): LoginRecord[] {
  const out: LoginRecord[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /^(wtmp|btmp|reboot)/.test(trimmed)) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 4) continue
    const looksIp = /^\d{1,3}(\.\d{1,3}){3}$|^[0-9a-f:]+$/i.test(parts[2])
    out.push({
      user: parts[0],
      from: looksIp ? parts[2] : '',
      when: parts.slice(looksIp ? 3 : 2, looksIp ? 8 : 7).join(' '),
      failed
    })
  }
  return out
}

/** `apt-get -s upgrade` / `dnf check-update` rows. */
export function parseUpdateLines(lines: string[]): string[] {
  return lines.map((l) => {
    const inst = /^Inst\s+(\S+)\s+(?:\[([^\]]*)\]\s*)?\(([^\s)]+)/.exec(l)
    if (inst) return `${inst[1]}  ${inst[2] ? `${inst[2]} → ` : ''}${inst[3]}`
    return l.trim().split(/\s+/).slice(0, 2).join('  ')
  })
}

// -------------------------------------------------------------------- services

/** `systemctl list-units` + `list-unit-files` merged into one list. */
export function parseServiceUnits(unitLines: string[], fileLines: string[]): ServiceUnit[] {
  const startup = new Map<string, string>()
  for (const line of fileLines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) startup.set(parts[0], parts[1])
  }
  const units: ServiceUnit[] = []
  for (const raw of unitLines) {
    const line = raw.replace(/^[●*✕]\s*/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 4 || !parts[0].endsWith('.service')) continue
    units.push({
      name: parts[0],
      load: parts[1],
      active: parts[2],
      sub: parts[3],
      description: parts.slice(4).join(' '),
      startup: startup.get(parts[0]) ?? ''
    })
  }
  return units.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------- docker

function splitPipe(lines: string[]): string[][] {
  return lines.filter((l) => l.includes('|')).map((l) => l.split('|'))
}

export function parseDockerContainers(lines: string[]): DockerContainer[] {
  return splitPipe(lines).map((p) => ({
    id: p[0]?.trim() ?? '',
    name: p[1]?.trim() ?? '',
    image: p[2]?.trim() ?? '',
    state: p[3]?.trim() ?? '',
    status: p[4]?.trim() ?? '',
    ports: p[5]?.trim() ?? ''
  }))
}

export function parseDockerImages(lines: string[]): DockerImage[] {
  return splitPipe(lines).map((p) => ({
    id: p[0]?.trim() ?? '',
    repository: p[1]?.trim() ?? '',
    tag: p[2]?.trim() ?? '',
    size: p[3]?.trim() ?? '',
    created: p[4]?.trim() ?? ''
  }))
}
