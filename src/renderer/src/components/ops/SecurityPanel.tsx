import { useCallback, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Info,
  Package,
  Plus,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X
} from 'lucide-react'
import type { RemoteHostInfo, SecurityReport, Server, UpdateReport } from '@shared/types'
import { cn, Button, Input } from '../../lib/ui'
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

const ACTIONS = ['allow', 'deny', 'reject', 'limit'] as const
type RuleAction = (typeof ACTIONS)[number]

export default function SecurityPanel({
  server,
  info,
  active
}: {
  server: Server
  info?: RemoteHostInfo
  active: boolean
}): ReactNode {
  const load = useCallback(() => window.api.ops.security(server), [server])
  const { data, error, loading, refresh } = useLoader<SecurityReport>(load, active)
  const [busy, setBusy] = useState('')
  const [adding, setAdding] = useState(false)
  const [updates, setUpdates] = useState<UpdateReport | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [showFailed, setShowFailed] = useState(false)

  const ufwRun = async (args: string, label: string): Promise<void> => {
    setBusy(args)
    const res = await window.api.ops.ufw(server, args)
    setBusy('')
    if (!res.ok) toast.error(`${label} failed: ${res.error}`)
    else {
      toast.success(label)
      refresh()
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setCheckingUpdates(true)
    const res = await window.api.ops.updates(server)
    setCheckingUpdates(false)
    if (!res.ok) toast.error(`Update check failed: ${res.error}`)
    else setUpdates(res.data ?? null)
  }

  const unban = async (jail: string, ip: string): Promise<void> => {
    const res = await window.api.ops.fail2banUnban(server, jail, ip)
    if (!res.ok) toast.error(`Unban failed: ${res.error}`)
    else {
      toast.success(`${ip} unbanned`)
      refresh()
    }
  }

  if (!data && loading) return <Loading label="Auditing the host…" />
  if (!data) return <PanelError message={error || 'No data'} onRetry={refresh} />

  const { ufw, fail2ban, sshd, ports, logins } = data
  const risky = sshd.filter((s) => s.status === false)
  const logs = logins.filter((l) => l.failed === showFailed)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-3 py-1.5">
        <ShieldCheck size={13} className="text-ink-faint" />
        <span className="text-[12px] font-semibold">Security</span>
        {!data.elevated && (
          <span className="flex items-center gap-1 text-[11px] text-warn">
            <AlertTriangle size={12} />
            Partial results — {info?.canSudo ? 'sudo was refused' : 'root access is unavailable'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ToolButton
            icon={<Package size={13} />}
            onClick={() => void checkUpdates()}
            disabled={checkingUpdates}
          >
            {checkingUpdates ? 'Checking…' : 'Check updates'}
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
        {/* Firewall */}
        <Card
          title="Firewall (ufw)"
          right={
            ufw.installed ? (
              <>
                <Badge tone={ufw.active ? 'ok' : 'bad'}>{ufw.active ? 'active' : 'inactive'}</Badge>
                {ufw.active ? (
                  <ToolButton
                    icon={<ShieldOff size={13} />}
                    danger
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (
                        confirm(
                          `Disable the firewall on ${server.name}? All ports will be reachable.`
                        )
                      )
                        void ufwRun('disable', 'Firewall disabled')
                    }}
                  >
                    Disable
                  </ToolButton>
                ) : (
                  <ToolButton
                    icon={<ShieldCheck size={13} />}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (
                        confirm(
                          'Enable the firewall? Make sure an SSH rule exists first or you may lock yourself out.'
                        )
                      )
                        void ufwRun('--force enable', 'Firewall enabled')
                    }}
                  >
                    Enable
                  </ToolButton>
                )}
                <ToolButton
                  icon={<RotateCw size={13} />}
                  title="Reload rules"
                  disabled={Boolean(busy)}
                  onClick={() => void ufwRun('reload', 'Firewall reloaded')}
                />
                <ToolButton
                  icon={adding ? <X size={13} /> : <Plus size={13} />}
                  onClick={() => setAdding((a) => !a)}
                >
                  {adding ? 'Cancel' : 'Add rule'}
                </ToolButton>
              </>
            ) : (
              <Badge tone="warn">not installed</Badge>
            )
          }
        >
          {!ufw.installed ? (
            <p className="text-[12px] text-ink-faint">
              ufw is not installed on this host.
              {data.otherFirewall
                ? ` A ${data.otherFirewall} firewall was detected instead — manage it from the SSH terminal.`
                : ' Install it with `apt install ufw` to manage rules from here.'}
            </p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-faint">
                {ufw.defaults && (
                  <span>
                    Defaults: <span className="text-ink-soft">{ufw.defaults}</span>
                  </span>
                )}
                {ufw.logging && (
                  <span>
                    Logging: <span className="text-ink-soft">{ufw.logging}</span>
                  </span>
                )}
              </div>

              {adding && (
                <AddRuleForm
                  busy={Boolean(busy)}
                  onCancel={() => setAdding(false)}
                  onSubmit={async (args) => {
                    await ufwRun(args, 'Rule added')
                    setAdding(false)
                  }}
                />
              )}

              {ufw.rules.length === 0 ? (
                <p className="text-[12px] text-ink-faint">
                  No rules yet{ufw.active ? ' — the default policy applies.' : '.'}
                </p>
              ) : (
                <div className="-mx-3.5 -mb-3.5 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <Th align="right">#</Th>
                        <Th>To</Th>
                        <Th>Action</Th>
                        <Th>From</Th>
                        <Th>Comment</Th>
                        <Th align="right">Delete</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ufw.rules.map((rule) => (
                        <tr key={rule.num} className="border-b border-line/40 hover:bg-bg-hover">
                          <Td align="right" className="font-mono text-[11px] text-ink-faint">
                            {rule.num}
                          </Td>
                          <Td className="font-semibold">{rule.to}</Td>
                          <Td>
                            <Badge tone={/ALLOW/.test(rule.action) ? 'ok' : 'bad'}>
                              {rule.action}
                            </Badge>
                          </Td>
                          <Td className="text-ink-soft">{rule.from}</Td>
                          <Td className="text-[11px] text-ink-faint">{rule.comment ?? ''}</Td>
                          <Td align="right">
                            <ToolButton
                              icon={<Trash2 size={13} />}
                              danger
                              title="Delete rule"
                              disabled={Boolean(busy)}
                              onClick={() => {
                                if (confirm(`Delete ufw rule ${rule.num} (${rule.to})?`))
                                  void ufwRun(`--force delete ${rule.num}`, 'Rule deleted')
                              }}
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        {/* SSH hardening */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card
            title="SSH hardening"
            right={
              sshd.length === 0 ? (
                <Badge tone="warn">unavailable</Badge>
              ) : risky.length ? (
                <Badge tone="bad">{risky.length} to fix</Badge>
              ) : (
                <Badge tone="ok">all good</Badge>
              )
            }
          >
            {sshd.length === 0 ? (
              <p className="text-[12px] text-ink-faint">
                Could not read the effective sshd config (needs root).
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sshd.map((item) => (
                  <li key={item.key} className="flex items-start gap-2 text-[12px]">
                    <span className="mt-0.5 shrink-0">
                      {item.status === true ? (
                        <CheckCircle2 size={13} className="text-ok" />
                      ) : item.status === false ? (
                        <AlertTriangle size={13} className="text-bad" />
                      ) : (
                        <Info size={13} className="text-ink-faint" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-soft">{item.key}</span>{' '}
                      <span className="font-mono text-[11px] text-ink">{item.value}</span>
                      {item.advice && (
                        <span className="block text-[11px] text-ink-faint">{item.advice}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* fail2ban */}
          <Card
            title="fail2ban"
            right={
              fail2ban.installed ? (
                <Badge tone="ok">{fail2ban.jails.length} jails</Badge>
              ) : (
                <Badge tone="warn">not installed</Badge>
              )
            }
          >
            {!fail2ban.installed ? (
              <p className="text-[12px] text-ink-faint">
                fail2ban is not installed. It bans IPs that repeatedly fail to authenticate.
              </p>
            ) : fail2ban.jails.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No active jails.</p>
            ) : (
              <div className="space-y-3">
                {fail2ban.jails.map((jail) => (
                  <div key={jail.name}>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="font-semibold">{jail.name}</span>
                      <span className="text-[11px] text-ink-faint">
                        {jail.currentlyFailed} failing · {jail.banned.length} banned ·{' '}
                        {jail.totalBanned} total
                      </span>
                    </div>
                    {jail.banned.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {jail.banned.map((ip) => (
                          <span
                            key={ip}
                            className="flex items-center gap-1 rounded-md bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-ink-soft"
                          >
                            {ip}
                            <button
                              title="Unban"
                              className="text-ink-faint hover:text-bad"
                              onClick={() => void unban(jail.name, ip)}
                            >
                              <Ban size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Listening ports */}
        <Card
          title="Listening ports"
          right={<Badge>{ports.length}</Badge>}
        >
          {ports.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Nothing is listening (or `ss` is missing).</p>
          ) : (
            <div className="-mx-3.5 -mb-3.5 max-h-[300px] overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Proto</Th>
                    <Th align="right">Port</Th>
                    <Th>Address</Th>
                    <Th>Process</Th>
                    <Th align="right">Firewall</Th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p, i) => {
                    const exposed = p.address === '*' || p.address === '0.0.0.0' || p.address === '[::]'
                    // A rule covers this port when its "To" column is the port
                    // itself (`22`) or the port with a protocol (`22/tcp`).
                    const allowed = ufw.rules.some(
                      (r) => r.to === p.port || r.to.startsWith(`${p.port}/`)
                    )
                    return (
                      <tr key={`${p.proto}-${p.address}-${p.port}-${i}`} className="border-b border-line/40 hover:bg-bg-hover">
                        <Td className="font-mono text-[11px] text-ink-faint">{p.proto}</Td>
                        <Td align="right" className="font-mono font-semibold">
                          {p.port}
                        </Td>
                        <Td className="text-[11px] text-ink-soft">
                          {p.address}
                          {exposed && (
                            <span className="ml-1.5 text-[10px] font-bold uppercase text-warn">
                              public
                            </span>
                          )}
                        </Td>
                        <Td className="text-[12px]">
                          {p.process || '—'}
                          {p.pid ? (
                            <span className="ml-1 text-[11px] text-ink-faint">({p.pid})</span>
                          ) : null}
                        </Td>
                        <Td align="right">
                          {ufw.installed && !allowed ? (
                            <ToolButton
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void ufwRun(
                                  `allow ${p.port}/${p.proto}`,
                                  `Allowed ${p.port}/${p.proto}`
                                )
                              }
                            >
                              allow
                            </ToolButton>
                          ) : ufw.installed ? (
                            <Badge tone="ok">in ufw</Badge>
                          ) : null}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Logins + updates */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card
            title="Recent logins"
            right={
              <>
                <ToolButton active={!showFailed} onClick={() => setShowFailed(false)}>
                  Accepted
                </ToolButton>
                <ToolButton active={showFailed} onClick={() => setShowFailed(true)}>
                  Failed
                </ToolButton>
              </>
            }
          >
            {logs.length === 0 ? (
              <p className="text-[12px] text-ink-faint">
                {showFailed
                  ? 'No failed logins recorded (or btmp is unreadable).'
                  : 'No login history available.'}
              </p>
            ) : (
              <table className="w-full">
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={`${l.user}-${i}`} className="border-b border-line/40 last:border-0">
                      <Td className={cn('font-semibold', l.failed && 'text-bad')}>{l.user}</Td>
                      <Td className="font-mono text-[11px] text-ink-soft">{l.from || 'local'}</Td>
                      <Td align="right" className="text-[11px] text-ink-faint">
                        {l.when}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title="Pending updates"
            right={
              updates ? (
                <Badge tone={updates.security ? 'bad' : updates.total ? 'warn' : 'ok'}>
                  {updates.total} available
                </Badge>
              ) : null
            }
          >
            {!updates ? (
              <p className="text-[12px] text-ink-faint">
                Run “Check updates” to list upgradable packages (read-only simulation).
              </p>
            ) : updates.total === 0 ? (
              <p className="text-[12px] text-ok">
                Everything is up to date ({updates.manager}).
              </p>
            ) : (
              <>
                <p className="mb-2 text-[12px] text-ink-soft">
                  {updates.total} package{updates.total === 1 ? '' : 's'} upgradable via{' '}
                  {updates.manager}
                  {updates.security > 0 && (
                    <span className="text-bad"> · {updates.security} security</span>
                  )}
                </p>
                <div className="max-h-[220px] overflow-auto rounded-lg bg-bg-input p-2 font-mono text-[11px] text-ink-soft">
                  {updates.packages.map((p, i) => (
                    <div key={`${p}-${i}`} className="truncate">
                      {p}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Builds a `ufw allow …` argument string from a small guided form. */
function AddRuleForm({
  busy,
  onSubmit,
  onCancel
}: {
  busy: boolean
  onSubmit: (args: string) => void | Promise<void>
  onCancel: () => void
}): ReactNode {
  const [action, setAction] = useState<RuleAction>('allow')
  const [port, setPort] = useState('')
  const [proto, setProto] = useState<'tcp' | 'udp' | 'any'>('tcp')
  const [from, setFrom] = useState('')

  const target = port.trim()
  const source = from.trim()
  const valid =
    /^[\w-]+(:\d+)?$/.test(target) && (!source || /^[\d./a-fA-F:]+$/.test(source))

  const args = (): string => {
    const spec = proto === 'any' ? target : `${target}/${proto}`
    if (source) {
      return proto === 'any'
        ? `${action} from ${source} to any port ${target}`
        : `${action} from ${source} to any port ${target} proto ${proto}`
    }
    return `${action} ${spec}`
  }

  return (
    <form
      className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-bg-elevated p-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) void onSubmit(args())
      }}
    >
      <label className="block">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          Action
        </div>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as RuleAction)}
          className="h-8 rounded-md border border-line bg-bg-input px-2 text-[12px] outline-none focus:border-accent"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          Port or service
        </div>
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="443 or ssh"
          className="h-8 w-32 py-0 text-[12px]"
        />
      </label>
      <label className="block">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          Protocol
        </div>
        <select
          value={proto}
          onChange={(e) => setProto(e.target.value as 'tcp' | 'udp' | 'any')}
          className="h-8 rounded-md border border-line bg-bg-input px-2 text-[12px] outline-none focus:border-accent"
        >
          <option value="tcp">tcp</option>
          <option value="udp">udp</option>
          <option value="any">any</option>
        </select>
      </label>
      <label className="block">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          From (optional)
        </div>
        <Input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="10.0.0.0/8"
          className="h-8 w-36 py-0 text-[12px]"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!valid || busy}>
          Add rule
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {target && (
        <code className="w-full font-mono text-[11px] text-ink-faint">ufw {args()}</code>
      )}
    </form>
  )
}
