import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Cog, FileText, Play, Power, RotateCw, Square } from 'lucide-react'
import type { Server, ServiceUnit } from '@shared/types'
import { cn, Modal } from '../../lib/ui'
import { toast } from '../../lib/toast'
import {
  Badge,
  Card,
  FilterInput,
  Loading,
  PanelError,
  Td,
  Th,
  ToolButton,
  useLoader
} from './common'

type StateFilter = 'all' | 'running' | 'failed' | 'stopped'

const FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'failed', label: 'Failed' },
  { id: 'stopped', label: 'Stopped' }
]

function tone(unit: ServiceUnit): 'ok' | 'bad' | 'neutral' {
  if (unit.active === 'failed' || unit.sub === 'failed') return 'bad'
  if (unit.active === 'active') return 'ok'
  return 'neutral'
}

export default function ServicesPanel({
  server,
  active
}: {
  server: Server
  active: boolean
}): ReactNode {
  const load = useCallback(() => window.api.ops.services(server), [server])
  const { data, error, loading, refresh } = useLoader<ServiceUnit[]>(load, active)
  const [filter, setFilter] = useState('')
  const [state, setState] = useState<StateFilter>('running')
  const [busy, setBusy] = useState('')
  const [logsFor, setLogsFor] = useState<ServiceUnit | null>(null)

  const units = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (data ?? []).filter((u) => {
      if (needle && !u.name.toLowerCase().includes(needle) && !u.description.toLowerCase().includes(needle))
        return false
      if (state === 'running') return u.active === 'active'
      if (state === 'failed') return u.active === 'failed' || u.sub === 'failed'
      if (state === 'stopped') return u.active !== 'active' && u.active !== 'failed'
      return true
    })
  }, [data, filter, state])

  const act = async (unit: ServiceUnit, action: string): Promise<void> => {
    if (
      (action === 'stop' || action === 'disable') &&
      !confirm(`${action === 'stop' ? 'Stop' : 'Disable'} ${unit.name} on ${server.name}?`)
    )
      return
    setBusy(`${unit.name}:${action}`)
    const res = await window.api.ops.serviceAction(server, unit.name, action)
    setBusy('')
    if (!res.ok) toast.error(`${action} ${unit.name}: ${res.error}`)
    else {
      toast.success(`${unit.name} ${action}ed`)
      refresh()
    }
  }

  if (!data && loading) return <Loading label="Listing systemd units…" />
  if (!data) return <PanelError message={error || 'No data'} onRetry={refresh} />

  const failed = data.filter((u) => u.active === 'failed' || u.sub === 'failed').length

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg-panel px-3 py-1.5">
        <Cog size={13} className="text-ink-faint" />
        <span className="text-[12px] font-semibold">Services</span>
        <span className="text-[11px] text-ink-faint">
          {data.length} units
          {failed > 0 && <span className="ml-1 text-bad">· {failed} failed</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {FILTERS.map((f) => (
            <ToolButton key={f.id} active={state === f.id} onClick={() => setState(f.id)}>
              {f.label}
            </ToolButton>
          ))}
          <FilterInput value={filter} onChange={setFilter} placeholder="Filter…" className="w-40" />
          <ToolButton
            icon={<RotateCw size={13} className={cn(loading && 'animate-spin')} />}
            title="Refresh"
            onClick={refresh}
          />
        </div>
      </div>

      {error && <PanelError message={error} onRetry={refresh} />}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Unit</Th>
              <Th>State</Th>
              <Th>Startup</Th>
              <Th>Description</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const running = unit.active === 'active'
              const disabled = Boolean(busy)
              return (
                <tr key={unit.name} className="border-b border-line/40 hover:bg-bg-hover">
                  <Td className="max-w-0 truncate font-semibold" title={unit.name}>
                    {unit.name.replace(/\.service$/, '')}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={tone(unit)}>{unit.active}</Badge>
                      <span className="text-[11px] text-ink-faint">{unit.sub}</span>
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'text-[11px]',
                        unit.startup === 'enabled'
                          ? 'text-ok'
                          : unit.startup === 'masked'
                            ? 'text-bad'
                            : 'text-ink-faint'
                      )}
                    >
                      {unit.startup || '—'}
                    </span>
                  </Td>
                  <Td className="max-w-0 truncate text-[11px] text-ink-soft" title={unit.description}>
                    {unit.description}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-0.5">
                      {running ? (
                        <>
                          <ToolButton
                            icon={<RotateCw size={12} />}
                            title="Restart"
                            disabled={disabled}
                            onClick={() => void act(unit, 'restart')}
                          />
                          <ToolButton
                            icon={<Square size={12} />}
                            title="Stop"
                            danger
                            disabled={disabled}
                            onClick={() => void act(unit, 'stop')}
                          />
                        </>
                      ) : (
                        <ToolButton
                          icon={<Play size={12} />}
                          title="Start"
                          disabled={disabled}
                          onClick={() => void act(unit, 'start')}
                        />
                      )}
                      <ToolButton
                        icon={<Power size={12} />}
                        title={unit.startup === 'enabled' ? 'Disable at boot' : 'Enable at boot'}
                        active={unit.startup === 'enabled'}
                        disabled={disabled}
                        onClick={() =>
                          void act(unit, unit.startup === 'enabled' ? 'disable' : 'enable')
                        }
                      />
                      <ToolButton
                        icon={<FileText size={12} />}
                        title="Status & logs"
                        onClick={() => setLogsFor(unit)}
                      />
                    </span>
                  </Td>
                </tr>
              )
            })}
            {units.length === 0 && (
              <tr>
                <Td className="py-6 text-center text-ink-faint">No units match this filter.</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {logsFor && <ServiceLogs server={server} unit={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  )
}

function ServiceLogs({
  server,
  unit,
  onClose
}: {
  server: Server
  unit: ServiceUnit
  onClose: () => void
}): ReactNode {
  const load = useCallback(
    () => window.api.ops.serviceLogs(server, unit.name, 300),
    [server, unit.name]
  )
  const { data, error, loading, refresh } = useLoader<string>(load)

  return (
    <Modal title={unit.name} onClose={onClose} width={900}>
      <div className="flex h-[62vh] flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={tone(unit)}>{unit.active}</Badge>
          <span className="text-[11px] text-ink-faint">{unit.description}</span>
          <ToolButton
            className="ml-auto"
            icon={<RotateCw size={13} className={cn(loading && 'animate-spin')} />}
            onClick={refresh}
          >
            Refresh
          </ToolButton>
        </div>
        {error ? (
          <PanelError message={error} onRetry={refresh} />
        ) : data === null ? (
          <Loading />
        ) : (
          <Card className="min-h-0 flex-1 overflow-auto">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-soft">
              {data || 'No output.'}
            </pre>
          </Card>
        )}
      </div>
    </Modal>
  )
}
