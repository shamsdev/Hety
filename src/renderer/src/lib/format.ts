import type { QueryResult } from '@shared/types'

export function cellString(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function escapeCsv(s: string, delimiter: string): string {
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function toDelimited(result: QueryResult, delimiter: string): string {
  const head = result.columns.map((c) => escapeCsv(c, delimiter)).join(delimiter)
  const body = result.rows
    .map((row) => row.map((v) => escapeCsv(cellString(v), delimiter)).join(delimiter))
    .join('\n')
  return body ? `${head}\n${body}` : head
}

export function toCsv(result: QueryResult): string {
  return toDelimited(result, ',')
}

export function toTsv(result: QueryResult): string {
  return toDelimited(result, '\t')
}

export function toMarkdown(result: QueryResult): string {
  const cols = result.columns
  if (!cols.length) return ''
  const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const header = `| ${cols.map(esc).join(' | ')} |`
  const sep = `| ${cols.map(() => '---').join(' | ')} |`
  const rows = result.rows.map((row) => `| ${row.map((v) => esc(cellString(v))).join(' | ')} |`)
  return [header, sep, ...rows].join('\n')
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/** Collapse a statement onto one line for a compact list row. */
export function oneLine(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Short "how long ago" label: 12s, 4m, 3h, 2d, then a date. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(at).toLocaleDateString()
}
