import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Plus,
  Database as DbIcon,
  Pencil,
  Trash2,
  X,
  RotateCw,
  RefreshCw,
  Power,
  Search,
  Bookmark,
  FileCode2,
  Lock,
  Unlock,
  MoreHorizontal
} from 'lucide-react'
import type { Project, Database, DbSchema, SchemaTable } from '@shared/types'
import { getDatabaseKindInfo } from '@shared/databases'
import { buildSelectAll, quoteQualified } from '@shared/sql'
import { useApp, useOpenRequest, newId } from '../../store'
import { cn, EmptyState, StatusDot, colorTint, AnchorMenu } from '../../lib/ui'
import { ResizeHandle, usePersistedSize } from '../../lib/resize'
import DatabaseDialog from '../dialogs/DatabaseDialog'
import DatabaseLogo from './DatabaseLogo'
import SchemaTree from './SchemaTree'
import SqlConsole, { type EditTable } from './SqlConsole'

interface Conn {
  id: string | null
  status: 'idle' | 'connecting' | 'connected' | 'error'
  error?: string
}
interface ConsoleTab {
  tabId: string
  title: string
  initialSql?: string
  autorun?: boolean
  editTable?: EditTable
}

const STATUS_COLOR: Record<Conn['status'], string> = {
  idle: '#646b78',
  connecting: '#e0b341',
  connected: '#46c08a',
  error: '#e0625e'
}

export default function DbPanel({ project }: { project: Project }): ReactNode {
  const deleteDatabase = useApp((s) => s.deleteDatabase)
  const upsertDatabase = useApp((s) => s.upsertDatabase)
  const savedQueries = useApp((s) => s.data.savedQueries)
  const addSavedQuery = useApp((s) => s.addSavedQuery)
  const deleteSavedQuery = useApp((s) => s.deleteSavedQuery)

  const [selectedDbId, setSelectedDbId] = useState<string | null>(null)
  const [conn, setConn] = useState<Conn>({ id: null, status: 'idle' })
  const [schema, setSchema] = useState<DbSchema | undefined>()
  const [tabs, setTabs] = useState<ConsoleTab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [gen, setGen] = useState(0)
  const [dialog, setDialog] = useState<{ database?: Database } | null>(null)
  const [savedSearch, setSavedSearch] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{
    top: number
    bottom: number
    left: number
    right: number
  } | null>(null)
  const [railW, setRailW] = usePersistedSize('db.rail', 240, 180, 420)
  const [schemaW, setSchemaW] = usePersistedSize('db.schema', 240, 160, 420)
  const setLive = useApp((s) => s.setLive)
  /** Saved query the palette asked for, opened once its database is connected. */
  const pendingQuery = useRef<string | null>(null)

  const selectedDb = project.databases.find((d) => d.id === selectedDbId) ?? null
  const selectedDbInfo = selectedDb ? getDatabaseKindInfo(selectedDb.kind) : null

  useEffect(() => {
    const key = conn.id ?? `db-${project.id}`
    setLive('db', project.id, key, conn.status === 'connected' && !!conn.id)
    return () => setLive('db', project.id, key, false)
  }, [conn.status, conn.id, project.id, setLive])

  const openConsole = (
    title: string,
    initialSql = '',
    autorun = false,
    editTable?: EditTable
  ): void => {
    const tabId = newId()
    setTabs((t) => [...t, { tabId, title, initialSql, autorun, editTable }])
    setActive(tabId)
  }

  const closeTab = (tabId: string): void => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.tabId !== tabId)
      setActive((a) => (a === tabId ? next[next.length - 1]?.tabId ?? null : a))
      return next
    })
  }

  // (Re)connect when the selected database changes.
  useEffect(() => {
    setSchema(undefined)
    setTabs([])
    setActive(null)
    if (!selectedDb) {
      setConn({ id: null, status: 'idle' })
      return
    }

    const info = getDatabaseKindInfo(selectedDb.kind)
    if (!info.supported) {
      setConn({ id: null, status: 'idle' })
      return
    }

    let cancelled = false
    let cid: string | null = null
    setConn({ id: null, status: 'connecting' })
    const server = selectedDb.useSsh
      ? project.servers.find((s) => s.id === selectedDb.sshServerId)
      : undefined
    ;(async () => {
      const r = await window.api.db.connect(selectedDb, server)
      if (cancelled) {
        if (r.ok && r.data) window.api.db.disconnect(r.data)
        return
      }
      if (!r.ok) {
        setConn({ id: null, status: 'error', error: r.error })
        return
      }
      cid = r.data!
      setConn({ id: cid, status: 'connected' })
      if (selectedDb.locked) void window.api.db.setReadOnly(cid, true)
      const dt = newId()
      const requested = pendingQuery.current
      pendingQuery.current = null
      const sq = requested ? savedQueries.find((q) => q.id === requested) : undefined
      setTabs([sq ? { tabId: dt, title: sq.name, initialSql: sq.sql } : { tabId: dt, title: 'Query' }])
      setActive(dt)
      const sc = await window.api.db.introspect(cid)
      if (!cancelled && sc.ok && sc.data) setSchema(sc.data)
    })()
    return () => {
      cancelled = true
      if (cid) window.api.db.disconnect(cid)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDbId, selectedDb?.kind, gen])

  // Command palette: select a database, or open a saved query on the one it belongs to.
  useOpenRequest(project.id, 'db', ({ kind, id }) => {
    if (!id) return
    if (kind === 'database') {
      if (project.databases.some((d) => d.id === id)) setSelectedDbId(id)
      return
    }
    if (kind !== 'query') return
    const sq = savedQueries.find((q) => q.id === id)
    if (!sq) return

    const target =
      sq.databaseId && project.databases.some((d) => d.id === sq.databaseId) ? sq.databaseId : null

    if (target && target !== selectedDbId) {
      // The connect effect clears the tab list, so hand the query to it instead.
      pendingQuery.current = sq.id
      setSelectedDbId(target)
    } else if (conn.status === 'connected') {
      openConsole(sq.name, sq.sql, false)
    } else if (target) {
      pendingQuery.current = sq.id
      setGen((g) => g + 1)
    }
  })

  const refreshSchema = async (): Promise<void> => {
    if (!conn.id) return
    const sc = await window.api.db.introspect(conn.id)
    if (sc.ok && sc.data) setSchema(sc.data)
  }

  const toggleLock = async (): Promise<void> => {
    if (!selectedDb) return
    const locked = !selectedDb.locked
    upsertDatabase(project.id, { ...selectedDb, locked })
    if (conn.id) await window.api.db.setReadOnly(conn.id, locked)
  }

  const openTable = (schemaName: string, table: SchemaTable): void => {
    const kind = selectedDb?.kind
    const qualified = quoteQualified(kind ?? 'postgresql', schemaName, table.name)
    const sql = buildSelectAll(kind ?? 'postgresql', schemaName, table.name)
    openConsole(table.name, sql, true, {
      table: qualified,
      name: table.name,
      columns: table.columns
    })
  }

  const onSave = (name: string, sql: string): void => {
    addSavedQuery({
      id: newId(),
      name,
      sql,
      projectId: project.id,
      databaseId: selectedDbId ?? undefined,
      createdAt: Date.now()
    })
  }

  const filteredSaved = useMemo(() => {
    const q = savedSearch.toLowerCase().trim()
    return savedQueries.filter(
      (sq) => !q || sq.name.toLowerCase().includes(q) || sq.sql.toLowerCase().includes(q)
    )
  }, [savedQueries, savedSearch])

  return (
    <div className="flex h-full">
      {/* Rail: databases + saved queries */}
      <div
        style={{ width: railW }}
        className="flex shrink-0 flex-col border-r border-line bg-bg-panel"
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Databases</span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft hover:bg-bg-hover hover:text-ink"
            title="Add database"
            onClick={() => setDialog({})}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="max-h-[45%] overflow-y-auto px-2">
          {project.databases.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-ink-faint">No databases yet.</p>
          )}
          {project.databases.map((d) => {
            const info = getDatabaseKindInfo(d.kind)
            const location = info.supportsHost
              ? `${d.host}/${d.database}`
              : d.database || `${info.name} profile`
            const bg = colorTint(d.color)
            const hoverBg = colorTint(d.color, 0.22)

            return (
              <div
                key={d.id}
                className={cn(
                  'group relative mb-1 rounded-lg px-2.5 py-2 transition-colors',
                  !d.color && (selectedDbId === d.id ? 'bg-accent-dim' : 'hover:bg-bg-hover'),
                  d.color && selectedDbId === d.id && 'ring-1 ring-accent/40'
                )}
                style={
                  d.color
                    ? {
                        backgroundColor: selectedDbId === d.id ? hoverBg : bg,
                        borderLeft: `3px solid ${d.color}`,
                        paddingLeft: 7
                      }
                    : undefined
                }
                onMouseEnter={(e) => {
                  if (hoverBg && selectedDbId !== d.id) e.currentTarget.style.backgroundColor = hoverBg
                }}
                onMouseLeave={(e) => {
                  if (bg && selectedDbId !== d.id) e.currentTarget.style.backgroundColor = bg
                }}
              >
                <button
                  className="flex w-full min-w-0 items-center gap-2 pr-7 text-left"
                  onClick={() => setSelectedDbId(d.id)}
                >
                  <span className="relative shrink-0">
                    <DatabaseLogo kind={d.kind} size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-[13px] font-semibold">{d.name}</span>
                      {selectedDbId === d.id && conn.status === 'connected' && (
                        <StatusDot color="#46c08a" />
                      )}
                      {d.locked && <Lock size={11} className="shrink-0 text-warn" />}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {info.name} - {d.useSsh ? 'ssh - ' : ''}
                      {location}
                    </span>
                  </span>
                </button>
                <button
                  title="Actions"
                  className={cn(
                    'absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-opacity hover:bg-black/10 hover:text-ink',
                    menuId === d.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (menuId === d.id) {
                      setMenuId(null)
                      setMenuAnchor(null)
                      return
                    }
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenuId(d.id)
                    setMenuAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
                {menuId === d.id && menuAnchor && (
                  <DatabaseMenu
                    anchor={menuAnchor}
                    onClose={() => {
                      setMenuId(null)
                      setMenuAnchor(null)
                    }}
                    onEdit={() => setDialog({ database: d })}
                    onDelete={() => {
                      if (confirm(`Delete database "${d.name}"?`)) {
                        if (selectedDbId === d.id) setSelectedDbId(null)
                        deleteDatabase(project.id, d.id)
                      }
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Saved queries */}
        <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-line">
          <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
            <Bookmark size={12} /> Saved queries
          </div>
          <div className="px-2 pb-1">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-2 text-ink-faint" />
              <input
                className="w-full rounded-md bg-bg-input py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent"
                placeholder="Search queries..."
                value={savedSearch}
                onChange={(e) => setSavedSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {filteredSaved.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-ink-faint">No saved queries.</p>
            )}
            {filteredSaved.map((sq) => (
              <div
                key={sq.id}
                className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-bg-hover"
                title={sq.sql}
              >
                <FileCode2 size={12} className="shrink-0 text-ink-faint" />
                <button
                  className="min-w-0 flex-1 truncate text-left text-[12px]"
                  onClick={() => openConsole(sq.name, sq.sql, false)}
                >
                  {sq.databaseId === selectedDbId && <span className="text-accent">* </span>}
                  {sq.name}
                </button>
                <button
                  className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 hover:text-bad group-hover:opacity-100"
                  title="Delete"
                  onClick={() => deleteSavedQuery(sq.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ResizeHandle axis="x" size={railW} onResize={setRailW} />

      {/* Main workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedDb ? (
          <EmptyState
            icon={<DbIcon size={42} />}
            title="Select a database"
            subtitle="Pick a connection on the left, or add a new one. You can test supported connections before saving."
          />
        ) : selectedDbInfo && !selectedDbInfo.supported ? (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-4 py-2">
              <DatabaseLogo kind={selectedDb.kind} size={18} />
              <span
                className="rounded-md px-1.5 py-0.5 text-[14px] font-bold"
                style={
                  selectedDb.color
                    ? { backgroundColor: colorTint(selectedDb.color, 0.22) }
                    : undefined
                }
              >
                {selectedDb.name}
              </span>
              <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-warn">
                PROFILE ONLY
              </span>
              <span className="text-[11px] text-ink-soft">{selectedDbInfo.name}</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-ink-soft hover:bg-bg-hover hover:text-ink"
                  onClick={() => setDialog({ database: selectedDb })}
                >
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </div>
            <EmptyState
              icon={<DatabaseLogo kind={selectedDb.kind} size={44} />}
              title={`${selectedDbInfo.name} profile`}
              subtitle="This database type can be selected and saved, but live connections, schema browsing, and query execution are not wired in this build yet."
            />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-4 py-2">
              <DatabaseLogo kind={selectedDb.kind} size={18} />
              <span
                className="rounded-md px-1.5 py-0.5 text-[14px] font-bold"
                style={
                  selectedDb.color
                    ? { backgroundColor: colorTint(selectedDb.color, 0.22) }
                    : undefined
                }
              >
                {selectedDb.name}
              </span>
              {selectedDbInfo && (
                <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                  {selectedDbInfo.name}
                </span>
              )}
              {selectedDb.locked && (
                <span className="flex items-center gap-1 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-warn">
                  <Lock size={10} /> LOCKED
                </span>
              )}
              <StatusDot color={STATUS_COLOR[conn.status]} />
              <span className="text-[11px] text-ink-soft">
                {conn.status === 'connected'
                  ? 'Connected'
                  : conn.status === 'connecting'
                    ? 'Connecting...'
                    : conn.status === 'error'
                      ? `Error: ${conn.error}`
                      : 'Disconnected'}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <ToolBtn
                  title={selectedDb.locked ? 'Unlock (allow writes)' : 'Lock (read-only)'}
                  onClick={toggleLock}
                >
                  {selectedDb.locked ? (
                    <Lock size={13} className="text-warn" />
                  ) : (
                    <Unlock size={13} />
                  )}
                </ToolBtn>
                <ToolBtn title="Refresh schema" onClick={refreshSchema} disabled={conn.status !== 'connected'}>
                  <RefreshCw size={13} />
                </ToolBtn>
                <ToolBtn title="Reconnect" onClick={() => setGen((g) => g + 1)}>
                  <RotateCw size={13} />
                </ToolBtn>
                <ToolBtn
                  title="Disconnect"
                  onClick={() => {
                    if (conn.id) window.api.db.disconnect(conn.id)
                    setConn({ id: null, status: 'idle' })
                    setSchema(undefined)
                  }}
                  disabled={conn.status !== 'connected'}
                >
                  <Power size={13} />
                </ToolBtn>
                <button
                  className="ml-1 flex items-center gap-1 rounded-md border border-line bg-bg-elevated px-2 py-1 text-[12px] font-semibold text-ink-soft hover:bg-bg-hover hover:text-ink"
                  onClick={() => openConsole('Query')}
                >
                  <Plus size={13} /> New Query
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div
                style={{ width: schemaW }}
                className="shrink-0 overflow-auto border-r border-line bg-bg-panel"
              >
                <SchemaTree
                  dbName={selectedDb.database}
                  kind={selectedDb.kind}
                  schema={schema}
                  onOpenTable={openTable}
                />
              </div>
              <ResizeHandle axis="x" size={schemaW} onResize={setSchemaW} />

              <div className="flex min-w-0 flex-1 flex-col bg-bg-base">
                {tabs.length === 0 ? (
                  <EmptyState icon={<FileCode2 size={36} />} title="No query open" subtitle="Press New Query." />
                ) : (
                  <>
                    <div className="flex items-stretch overflow-x-auto border-b border-line bg-bg-panel">
                      {tabs.map((t) => {
                        const color = selectedDb.color
                        return (
                          <button
                            key={t.tabId}
                            onClick={() => setActive(t.tabId)}
                            className={cn(
                              'group flex shrink-0 items-center gap-2 border-r border-t-2 border-line px-3.5 py-2 text-[13px]',
                              active === t.tabId
                                ? 'border-t-accent bg-bg-base text-ink'
                                : 'border-t-transparent text-ink-soft hover:bg-bg-hover'
                            )}
                          >
                            <FileCode2 size={12} style={color ? { color } : undefined} />
                            <span
                              className="max-w-[140px] truncate rounded px-1.5 py-0.5"
                              style={
                                color
                                  ? { backgroundColor: colorTint(color, active === t.tabId ? 0.22 : 0.14) }
                                  : undefined
                              }
                            >
                              {t.title}
                            </span>
                            {conn.status === 'connected' && <StatusDot color="#46c08a" />}
                            <span
                              className="rounded p-0.5 opacity-0 hover:bg-bg-hover hover:text-bad group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation()
                                closeTab(t.tabId)
                              }}
                            >
                              <X size={12} />
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="relative min-h-0 flex-1">
                      {tabs.map((t) => (
                        <div
                          key={t.tabId}
                          className={cn('absolute inset-0', active === t.tabId ? 'block' : 'hidden')}
                        >
                          <SqlConsole
                            connectionId={conn.id}
                            connected={conn.status === 'connected'}
                            kind={selectedDb.kind}
                            dbName={selectedDb.database}
                            schema={schema}
                            initialSql={t.initialSql}
                            autorun={t.autorun}
                            editTable={t.editTable}
                            locked={!!selectedDb.locked}
                            onSave={onSave}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {dialog && (
        <DatabaseDialog project={project} database={dialog.database} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function ToolBtn({
  children,
  onClick,
  title,
  disabled
}: {
  children: ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
}): ReactNode {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-bg-hover hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function DatabaseMenu({
  anchor,
  onClose,
  onEdit,
  onDelete
}: {
  anchor: { top: number; bottom: number; left: number; right: number }
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <AnchorMenu anchor={anchor} onClose={onClose}>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink hover:bg-bg-hover"
        onClick={() => {
          onEdit()
          onClose()
        }}
      >
        <Pencil size={13} /> Edit
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-bad hover:bg-bg-hover"
        onClick={() => {
          onDelete()
          onClose()
        }}
      >
        <Trash2 size={13} /> Delete
      </button>
    </AnchorMenu>
  )
}
