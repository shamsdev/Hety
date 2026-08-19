import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Result } from '@shared/types'
import { cn, Spinner } from '../../lib/ui'

// ------------------------------------------------------------------ formatting

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : digits)} ${UNITS[i]}`
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond, 1)}/s`
}

export function formatUptime(seconds: number): string {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

export function formatWhen(ms: number): string {
  if (!ms) return '—'
  const date = new Date(ms)
  const now = Date.now()
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
    ...(sameYear ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' })
  })
}

/** Green → amber → red for a 0-100 utilisation value. */
export function loadColor(percent: number): string {
  if (percent >= 90) return '#e0625e'
  if (percent >= 75) return '#e0b341'
  return '#46c08a'
}

// ----------------------------------------------------------------- data loading

interface Loader<T> {
  data: T | null
  error: string
  loading: boolean
  refresh: () => void
}

/**
 * Fetches once the panel first becomes `enabled`, then only on demand, keeping
 * the previous data visible while a refresh is in flight.
 */
export function useLoader<T>(load: () => Promise<Result<T>>, enabled = true): Loader<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const run = useRef(0)
  const started = useRef(false)

  const refresh = useCallback(() => {
    if (!enabled) return
    const ticket = ++run.current
    setLoading(true)
    void load()
      .then((res) => {
        if (ticket !== run.current) return
        if (res.ok) {
          setData((res.data ?? null) as T | null)
          setError('')
        } else {
          setError(res.error)
        }
      })
      .catch((e: Error) => {
        if (ticket === run.current) setError(e.message)
      })
      .finally(() => {
        if (ticket === run.current) setLoading(false)
      })
  }, [load, enabled])

  useEffect(() => {
    if (!enabled || started.current) return
    started.current = true
    refresh()
  }, [enabled, refresh])

  return { data, error, loading, refresh }
}

/** Calls `tick` on an interval while `enabled` — used by the live monitor. */
export function usePoll(tick: () => void, intervalMs: number, enabled: boolean): void {
  const saved = useRef(tick)
  saved.current = tick
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    const id = setInterval(() => saved.current(), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
}

// ------------------------------------------------------------------ primitives

export function Card({
  title,
  right,
  children,
  className
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <section className={cn('rounded-xl border border-line bg-bg-panel', className)}>
      {(title || right) && (
        <header className="flex items-center gap-2 border-b border-line px-3.5 py-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</h3>
          <div className="ml-auto flex items-center gap-1.5">{right}</div>
        </header>
      )}
      <div className="p-3.5">{children}</div>
    </section>
  )
}

type ToolButtonProps = {
  icon?: ReactNode
  children?: ReactNode
  onClick?: () => void
  title?: string
  disabled?: boolean
  active?: boolean
  danger?: boolean
  className?: string
}
export function ToolButton({
  icon,
  children,
  onClick,
  title,
  disabled,
  active,
  danger,
  className
}: ToolButtonProps): ReactNode {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-accent-dim text-accent-hover'
          : danger
            ? 'text-ink-soft hover:bg-bg-hover hover:text-bad'
            : 'text-ink-soft hover:bg-bg-hover hover:text-ink',
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent'
}): ReactNode {
  const tones: Record<string, string> = {
    neutral: 'bg-bg-elevated text-ink-soft',
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    accent: 'bg-accent-dim text-accent-hover'
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

/** Labelled horizontal utilisation bar. */
export function Meter({
  label,
  value,
  max,
  text,
  color
}: {
  label: ReactNode
  value: number
  max: number
  text?: ReactNode
  color?: string
}): ReactNode {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 truncate text-ink-soft">{label}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-faint">{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%`, background: color ?? loadColor(percent) }}
        />
      </div>
    </div>
  )
}

/** Circular gauge used for the CPU / memory / disk headline stats. */
export function Ring({
  percent,
  label,
  value,
  sub,
  size = 92,
  color
}: {
  percent: number
  label: string
  value: string
  sub?: string
  size?: number
  color?: string
}): ReactNode {
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const tone = color ?? loadColor(clamped)
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#23262e"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
            style={{ transition: 'stroke-dashoffset 600ms ease, stroke 400ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[16px] font-bold tabular-nums">{value}</span>
          {sub && <span className="text-[10px] text-ink-faint">{sub}</span>}
        </div>
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
    </div>
  )
}

/** Filled sparkline for a rolling history series. */
export function Sparkline({
  values,
  max,
  color = '#6d8cff',
  height = 42
}: {
  values: number[]
  max?: number
  color?: string
  height?: number
}): ReactNode {
  const width = 200
  const peak = Math.max(max ?? 0, ...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / peak) * height).toFixed(1)}`)
  const line = points.join(' ')
  const area = `0,${height} ${line} ${((values.length - 1) * step).toFixed(1)},${height}`
  const id = `spark-${color.replace('#', '')}`
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {values.length > 1 && (
        <>
          <polygon points={area} fill={`url(#${id})`} />
          <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  )
}

export function PanelError({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="m-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
      <span className="whitespace-pre-wrap">{message}</span>
      {onRetry && (
        <button className="ml-2 font-semibold underline hover:text-ink" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-faint">
      <Spinner /> {label}
    </div>
  )
}

/** Header cell for the compact tables used across the ops panels. */
export function Th({
  children,
  className,
  onClick,
  align = 'left'
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  align?: 'left' | 'right'
}): ReactNode {
  return (
    <th
      onClick={onClick}
      className={cn(
        'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-bg-panel px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint',
        align === 'right' ? 'text-right' : 'text-left',
        onClick && 'cursor-pointer hover:text-ink',
        className
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  align = 'left',
  title
}: {
  children: ReactNode
  className?: string
  align?: 'left' | 'right'
  title?: string
}): ReactNode {
  return (
    <td
      title={title}
      className={cn(
        'whitespace-nowrap px-3 py-1.5 text-[12px]',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
    >
      {children}
    </td>
  )
}

/** Small search box shared by the list-heavy panels. */
export function FilterInput({
  value,
  onChange,
  placeholder,
  className
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}): ReactNode {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'h-7 rounded-md border border-line bg-bg-input px-2 text-[12px] outline-none placeholder:text-ink-faint focus:border-accent',
        className
      )}
    />
  )
}
