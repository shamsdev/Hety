import { useCallback, useState, type ReactNode } from 'react'
import { Boxes, FileText, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import type { DockerContainer, DockerReport, Server } from '@shared/types'
import { cn, EmptyState, Modal } from '../../lib/ui'
import { toast } from '../../lib/toast'
import {
  Badge,
  Card,
  Loading,
  PanelError,
  Td,
  Th,
  ToolButton,
  useLoader
} from './common'

export default function DockerPanel({
  server,
  active
}: {
  server: Server
  active: boolean
}): ReactNode {
  const load = useCallback(() => window.api.ops.docker(server), [server])
  const { data, error, loading, refresh } = useLoader<DockerReport>(load, active)
  const [busy, setBusy] = useState('')
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null)

  const act = async (container: DockerContainer, action: string): Promise<void> => {
    if (action === 'rm' && !confirm(`Remove container "${container.name}"? This deletes it.`)) return
    if (action === 'stop' && !confirm(`Stop "${container.name}"?`)) return
    setBusy(container.id)
    const res = await window.api.ops.dockerAction(server, action, container.id)
    setBusy('')
    if (!res.ok) toast.error(`${action} failed: ${res.error}`)
    else {
      toast.success(`${container.name} ${action === 'rm' ? 'removed' : `${action}ed`}`)
      refresh()
    }
  }

  const prune = async (target: 'containers' | 'images' | 'system'): Promise<void> => {
    if (!confirm(`Prune unused ${target} on ${server.name}?`)) return
    setBusy(`prune-${target}`)
    const res = await window.api.ops.dockerPrune(server, target)
    setBusy('')
    if (!res.ok) toast.error(`Prune failed: ${res.error}`)
    else {
      toast.success(res.data?.trim().split('\n').pop() || 'Pruned')
      refresh()
    }
  }

  if (!data && loading) return <Loading label="Talking to the Docker daemon…" />
  if (!data) return <PanelError message={error || 'No data'} onRetry={refresh} />

  if (!data.installed) {
    return (
      <EmptyState
        icon={<Boxes size={40} />}
        title="Docker is not installed"
        subtitle="Install Docker on this host to manage containers and images from here."
      />
    )
  }
  if (!data.accessible) {
    return (
      <EmptyState
        icon={<Boxes size={40} />}
        title="Docker is not reachable"
        subtitle={
          data.message ??
          'The daemon is down, or this user cannot reach the socket and sudo was unavailable.'
        }
      />
    )
  }

  const running = data.containers.filter((c) => c.state === 'running').length

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg-panel px-3 py-1.5">
        <Boxes size={13} className="text-ink-faint" />
        <span className="text-[12px] font-semibold">Docker</span>
        <span className="text-[11px] text-ink-faint">
          {running}/{data.containers.length} running · {data.images.length} images
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton disabled={Boolean(busy)} onClick={() => void prune('containers')}>
            Prune containers
          </ToolButton>
          <ToolButton disabled={Boolean(busy)} onClick={() => void prune('images')}>
            Prune images
          </ToolButton>
          <ToolButton
            icon={<RotateCw size={13} className={cn(loading && 'animate-spin')} />}
            title="Refresh"
            onClick={refresh}
          />
        </div>
      </div>

      {error && <PanelError message={error} onRetry={refresh} />}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Card title="Containers" className="pb-0">
          <div className="-mx-3.5 -mb-3.5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Image</Th>
                  <Th>State</Th>
                  <Th>Status</Th>
                  <Th>Ports</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {data.containers.map((c) => {
                  const isRunning = c.state === 'running'
                  return (
                    <tr key={c.id} className="border-b border-line/40 hover:bg-bg-hover">
                      <Td className="font-semibold">{c.name}</Td>
                      <Td className="max-w-0 truncate text-[11px] text-ink-soft" title={c.image}>
                        {c.image}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            isRunning
                              ? 'ok'
                              : c.state === 'exited' || c.state === 'dead'
                                ? 'bad'
                                : 'neutral'
                          }
                        >
                          {c.state}
                        </Badge>
                      </Td>
                      <Td className="text-[11px] text-ink-faint">{c.status}</Td>
                      <Td className="max-w-0 truncate font-mono text-[11px] text-ink-faint" title={c.ports}>
                        {c.ports || '—'}
                      </Td>
                      <Td align="right">
                        <span className="flex justify-end gap-0.5">
                          {isRunning ? (
                            <>
                              <ToolButton
                                icon={<RotateCw size={12} />}
                                title="Restart"
                                disabled={Boolean(busy)}
                                onClick={() => void act(c, 'restart')}
                              />
                              <ToolButton
                                icon={<Square size={12} />}
                                title="Stop"
                                danger
                                disabled={Boolean(busy)}
                                onClick={() => void act(c, 'stop')}
                              />
                            </>
                          ) : (
                            <ToolButton
                              icon={<Play size={12} />}
                              title="Start"
                              disabled={Boolean(busy)}
                              onClick={() => void act(c, 'start')}
                            />
                          )}
                          <ToolButton
                            icon={<FileText size={12} />}
                            title="Logs"
                            onClick={() => setLogsFor(c)}
                          />
                          <ToolButton
                            icon={<Trash2 size={12} />}
                            title="Remove"
                            danger
                            disabled={Boolean(busy)}
                            onClick={() => void act(c, 'rm')}
                          />
                        </span>
                      </Td>
                    </tr>
                  )
                })}
                {data.containers.length === 0 && (
                  <tr>
                    <Td className="py-6 text-center text-ink-faint">No containers.</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Images" className="pb-0">
          <div className="-mx-3.5 -mb-3.5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Repository</Th>
                  <Th>Tag</Th>
                  <Th align="right">Size</Th>
                  <Th>Created</Th>
                  <Th>ID</Th>
                </tr>
              </thead>
              <tbody>
                {data.images.map((img) => (
                  <tr key={`${img.id}-${img.tag}`} className="border-b border-line/40 hover:bg-bg-hover">
                    <Td className="max-w-0 truncate font-semibold" title={img.repository}>
                      {img.repository}
                    </Td>
                    <Td className="text-[11px] text-ink-soft">{img.tag}</Td>
                    <Td align="right" className="font-mono text-[11px] text-ink-soft">
                      {img.size}
                    </Td>
                    <Td className="text-[11px] text-ink-faint">{img.created}</Td>
                    <Td className="font-mono text-[11px] text-ink-faint">{img.id}</Td>
                  </tr>
                ))}
                {data.images.length === 0 && (
                  <tr>
                    <Td className="py-6 text-center text-ink-faint">No images.</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {logsFor && (
        <ContainerLogs server={server} container={logsFor} onClose={() => setLogsFor(null)} />
      )}
    </div>
  )
}

function ContainerLogs({
  server,
  container,
  onClose
}: {
  server: Server
  container: DockerContainer
  onClose: () => void
}): ReactNode {
  const load = useCallback(
    () => window.api.ops.dockerLogs(server, container.id, 400),
    [server, container.id]
  )
  const { data, error, loading, refresh } = useLoader<string>(load)

  return (
    <Modal title={`${container.name} — logs`} onClose={onClose} width={900}>
      <div className="flex h-[62vh] flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={container.state === 'running' ? 'ok' : 'neutral'}>{container.state}</Badge>
          <span className="text-[11px] text-ink-faint">{container.image}</span>
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
