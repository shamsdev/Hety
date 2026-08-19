import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowDown, ArrowUp, Cpu, HardDrive, RotateCw, Skull, Users } from 'lucide-react'
import type { ProcessInfo, RemoteMetrics, Server } from '@shared/types'
import { cn } from '../../lib/ui'
import { toast } from '../../lib/toast'
import {
  Card,
  FilterInput,
  Loading,
  Meter,
  PanelError,
  Ring,
  Sparkline,
  Td,
  Th,
  ToolButton,
  formatBytes,
  formatRate,
  formatUptime,
  loadColor,
  usePoll
} from './common'

const INTERVALS = [
  { label: '2s', value: 2000 },
  { label: '5s', value: 5000 },
  { label: '15s', value: 15000 },
  { label: 'off', value: 0 }
]

const HISTORY = 60

interface History {
  cpu: number[]
  mem: number[]
  rx: number[]
  tx: number[]
}

const EMPTY_HISTORY: History = { cpu: [], mem: [], rx: [], tx: [] }

function push(series: number[], value: number): number[] {
  const next = [...series, value]
  return next.length > HISTORY ? next.slice(next.length - HISTORY) : next
}

type ProcSort = 'cpu' | 'mem'

export default function MonitorPanel({
  server,
  active
}: {
  server: Server
  active: boolean
}): ReactNode {
  const [metrics, setMetrics] = useState<RemoteMetrics | null>(null)
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [error, setError] = useState('')
  const [interval, setIntervalMs] = useState(5000)
  const [procFilter, setProcFilter] = useState('')
  const [procSort, setProcSort] = useState<ProcSort>('cpu')
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(false)

  const tick = useCallback(async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    const res = await window.api.ops.metrics(server)
    inFlight.current = false
    setLoading(false)
    if (!res.ok || !res.data) {
      setError(res.ok ? 'Empty response' : res.error)
      return
    }
    const m = res.data
    setError('')
    setMetrics(m)
    setHistory((h) => ({
      cpu: push(h.cpu, m.cpu.usage),
      mem: push(h.mem, m.memory.total ? (m.memory.used / m.memory.total) * 100 : 0),
      rx: push(h.rx, m.net.reduce((sum, n) => sum + n.rxRate, 0)),
      tx: push(h.tx, m.net.reduce((sum, n) => sum + n.txRate, 0))
    }))
  }, [server])

  useEffect(() => {
    if (active && !metrics) void tick()
  }, [active, metrics, tick])

  usePoll(() => void tick(), interval, active)

  const processes = useMemo(() => {
    if (!metrics) return []
    const needle = procFilter.trim().toLowerCase()
    return metrics.processes
      .filter((p) => !needle || p.command.toLowerCase().includes(needle) || String(p.pid) === needle)
      .slice()
      .sort((a, b) => (procSort === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem))
  }, [metrics, procFilter, procSort])

  const kill = async (proc: ProcessInfo, force: boolean): Promise<void> => {
    if (!confirm(`Send SIG${force ? 'KILL' : 'TERM'} to ${proc.name} (pid ${proc.pid})?`)) return
    const res = await window.api.ops.kill(server, proc.pid, force ? 'KILL' : 'TERM')
    if (!res.ok) toast.error(`Kill failed: ${res.error}`)
    else {
      toast.success(`Signal sent to ${proc.pid}`)
      void tick()
    }
  }

  if (!metrics && error) return <PanelError message={error} onRetry={() => void tick()} />
  if (!metrics) return <Loading label="Sampling the host…" />

  const rootDisk =
    metrics.disks.find((d) => d.mount === '/') ??
    [...metrics.disks].sort((a, b) => b.size - a.size)[0]
  const memPercent = metrics.memory.total
    ? (metrics.memory.used / metrics.memory.total) * 100
    : 0
  const swapPercent = metrics.swap.total ? (metrics.swap.used / metrics.swap.total) * 100 : 0
  const perCore = metrics.cpu.cores.length ? metrics.cpu.cores : []
  const totalRx = metrics.net.reduce((s, n) => s + n.rxRate, 0)
  const totalTx = metrics.net.reduce((s, n) => s + n.txRate, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-3 py-1.5">
        <Activity size={13} className="text-ink-faint" />
        <span className="truncate text-[12px] font-semibold">{metrics.hostname}</span>
        <span className="truncate text-[11px] text-ink-faint">
          {metrics.os} · {metrics.kernel}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-[11px] text-ink-faint">Refresh</span>
          {INTERVALS.map((i) => (
            <ToolButton
              key={i.value}
              active={interval === i.value}
              onClick={() => setIntervalMs(i.value)}
            >
              {i.label}
            </ToolButton>
          ))}
          <ToolButton
            icon={<RotateCw size={13} className={cn(loading && 'animate-spin')} />}
            title="Refresh now"
            onClick={() => void tick()}
          />
        </div>
      </div>

      {error && <PanelError message={error} onRetry={() => void tick()} />}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* Headline gauges */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto,1fr]">
          <Card className="shrink-0">
            <div className="flex items-center gap-5">
              <Ring
                percent={metrics.cpu.usage}
                label="CPU"
                value={`${metrics.cpu.usage.toFixed(0)}%`}
                sub={`${metrics.cpu.count || perCore.length} cores`}
              />
              <Ring
                percent={memPercent}
                label="Memory"
                value={`${memPercent.toFixed(0)}%`}
                sub={formatBytes(metrics.memory.used)}
              />
              {rootDisk && (
                <Ring
                  percent={rootDisk.usePercent}
                  label="Disk"
                  value={`${rootDisk.usePercent}%`}
                  sub={formatBytes(rootDisk.available) + ' free'}
                />
              )}
            </div>
          </Card>

          <Card>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              <Stat label="Uptime" value={formatUptime(metrics.uptimeSeconds)} />
              <Stat
                label="Load (1 / 5 / 15m)"
                value={metrics.load.map((l) => l.toFixed(2)).join('  ')}
                tone={
                  metrics.cpu.count && metrics.load[0] > metrics.cpu.count ? 'bad' : undefined
                }
              />
              <Stat label="Processes" value={String(metrics.processCount)} />
              <Stat
                label="Memory"
                value={`${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`}
              />
              <Stat
                label="Swap"
                value={
                  metrics.swap.total
                    ? `${formatBytes(metrics.swap.used)} / ${formatBytes(metrics.swap.total)}`
                    : 'none'
                }
                tone={swapPercent > 50 ? 'warn' : undefined}
              />
              <Stat
                label="Network"
                value={`↓ ${formatRate(totalRx)}   ↑ ${formatRate(totalTx)}`}
              />
              {metrics.cpu.temperature !== undefined && (
                <Stat
                  label="Temperature"
                  value={`${metrics.cpu.temperature.toFixed(0)} °C`}
                  tone={metrics.cpu.temperature > 80 ? 'bad' : undefined}
                />
              )}
              <Stat label="Sessions" value={String(metrics.sessions.length)} />
            </div>
          </Card>
        </div>

        {/* Trends */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card title="CPU history" right={<span className="text-[11px] text-ink-faint">{metrics.cpu.usage.toFixed(0)}%</span>}>
            <Sparkline values={history.cpu} max={100} color="#6d8cff" />
          </Card>
          <Card title="Memory history" right={<span className="text-[11px] text-ink-faint">{memPercent.toFixed(0)}%</span>}>
            <Sparkline values={history.mem} max={100} color="#b07ee6" />
          </Card>
          <Card
            title="Network"
            right={
              <span className="flex items-center gap-2 text-[11px] text-ink-faint">
                <span className="flex items-center gap-0.5">
                  <ArrowDown size={11} /> {formatRate(totalRx)}
                </span>
                <span className="flex items-center gap-0.5">
                  <ArrowUp size={11} /> {formatRate(totalTx)}
                </span>
              </span>
            }
          >
            <div className="relative">
              <Sparkline values={history.rx} color="#46c08a" height={20} />
              <Sparkline values={history.tx} color="#e0b341" height={20} />
            </div>
          </Card>
        </div>

        {/* Cores + disks */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {perCore.length > 0 && (
            <Card title={<span className="flex items-center gap-1.5"><Cpu size={12} /> Per-core load</span>}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {perCore.map((core) => (
                  <Meter
                    key={core.id}
                    label={`cpu${core.id}`}
                    value={core.usage}
                    max={100}
                    text={`${core.usage.toFixed(0)}%`}
                  />
                ))}
              </div>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-1.5"><HardDrive size={12} /> Filesystems</span>}>
            <div className="space-y-2.5">
              {metrics.disks.length === 0 && (
                <p className="text-[12px] text-ink-faint">No mounted filesystems reported.</p>
              )}
              {metrics.disks.map((disk) => (
                <Meter
                  key={disk.mount}
                  label={
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-ink">{disk.mount}</span>
                      <span className="text-ink-faint">{disk.filesystem}</span>
                    </span>
                  }
                  value={disk.used}
                  max={disk.size}
                  text={`${formatBytes(disk.used)} / ${formatBytes(disk.size)} · ${disk.usePercent}%`}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* Network interfaces + sessions */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Interfaces">
            <table className="w-full">
              <tbody>
                {metrics.net.map((n) => (
                  <tr key={n.name} className="border-b border-line/40 last:border-0">
                    <Td className="font-semibold">{n.name}</Td>
                    <Td align="right" className="font-mono text-[11px] text-ok">
                      ↓ {formatRate(n.rxRate)}
                    </Td>
                    <Td align="right" className="font-mono text-[11px] text-warn">
                      ↑ {formatRate(n.txRate)}
                    </Td>
                    <Td align="right" className="text-[11px] text-ink-faint">
                      {formatBytes(n.rxBytes)} / {formatBytes(n.txBytes)} total
                    </Td>
                  </tr>
                ))}
                {metrics.net.length === 0 && (
                  <tr>
                    <Td className="text-ink-faint">No interfaces reported.</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card title={<span className="flex items-center gap-1.5"><Users size={12} /> Logged in</span>}>
            {metrics.sessions.length === 0 ? (
              <p className="text-[12px] text-ink-faint">Nobody else is logged in.</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {metrics.sessions.map((s, i) => (
                    <tr key={`${s.user}-${s.tty}-${i}`} className="border-b border-line/40 last:border-0">
                      <Td className="font-semibold">{s.user}</Td>
                      <Td className="text-[11px] text-ink-faint">{s.tty}</Td>
                      <Td className="text-[11px] text-ink-soft">{s.from || 'local'}</Td>
                      <Td align="right" className="text-[11px] text-ink-faint">
                        {s.since}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Processes */}
        <Card
          title="Top processes"
          right={
            <>
              <ToolButton active={procSort === 'cpu'} onClick={() => setProcSort('cpu')}>
                CPU
              </ToolButton>
              <ToolButton active={procSort === 'mem'} onClick={() => setProcSort('mem')}>
                MEM
              </ToolButton>
              <FilterInput
                value={procFilter}
                onChange={setProcFilter}
                placeholder="Filter…"
                className="w-36"
              />
            </>
          }
          className="pb-0"
        >
          <div className="-mx-3.5 -mb-3.5 max-h-[380px] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th align="right">PID</Th>
                  <Th>User</Th>
                  <Th align="right">CPU</Th>
                  <Th align="right">MEM</Th>
                  <Th align="right">RSS</Th>
                  <Th>Command</Th>
                  <Th align="right">Kill</Th>
                </tr>
              </thead>
              <tbody>
                {processes.map((p) => (
                  <tr key={p.pid} className="border-b border-line/40 hover:bg-bg-hover">
                    <Td align="right" className="font-mono text-[11px] text-ink-faint">
                      {p.pid}
                    </Td>
                    <Td className="text-[11px] text-ink-soft">{p.user}</Td>
                    <Td align="right" className="font-mono" >
                      <span style={{ color: p.cpu > 50 ? loadColor(p.cpu) : undefined }}>
                        {p.cpu.toFixed(1)}%
                      </span>
                    </Td>
                    <Td align="right" className="font-mono text-ink-soft">
                      {p.mem.toFixed(1)}%
                    </Td>
                    <Td align="right" className="font-mono text-[11px] text-ink-faint">
                      {formatBytes(p.rss)}
                    </Td>
                    <Td className="max-w-0 truncate" title={p.command}>
                      <span className="font-semibold">{p.name}</span>{' '}
                      <span className="text-[11px] text-ink-faint">{p.command}</span>
                    </Td>
                    <Td align="right">
                      <span className="flex justify-end gap-1">
                        <ToolButton title="SIGTERM" onClick={() => void kill(p, false)}>
                          term
                        </ToolButton>
                        <ToolButton
                          icon={<Skull size={12} />}
                          title="SIGKILL"
                          danger
                          onClick={() => void kill(p, true)}
                        />
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'warn' | 'bad'
}): ReactNode {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</div>
      <div
        className={cn(
          'font-mono text-[13px]',
          tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink'
        )}
      >
        {value}
      </div>
    </div>
  )
}
