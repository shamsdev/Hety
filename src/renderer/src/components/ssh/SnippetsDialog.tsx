import { useState, type ReactNode } from 'react'
import { Plus, Pencil, Trash2, Play, Zap, ChevronLeft } from 'lucide-react'
import type { Server, Snippet } from '@shared/types'
import { useApp, newId } from '../../store'
import { Modal, Button, Input, Field, cn } from '../../lib/ui'

/**
 * Manage a server's saved commands. `onRun` is only passed when the dialog is
 * opened from a live terminal, so snippets can be fired straight from here.
 */
export default function SnippetsDialog({
  projectId,
  server,
  onRun,
  onClose
}: {
  projectId: string
  server: Server
  onRun?: (snippet: Snippet) => void
  onClose: () => void
}): ReactNode {
  const upsertServer = useApp((s) => s.upsertServer)
  const snippets = server.snippets ?? []
  const [editing, setEditing] = useState<Snippet | null>(null)

  const save = (next: Snippet[]): void => upsertServer(projectId, { ...server, snippets: next })

  const commit = (snippet: Snippet): void => {
    const exists = snippets.some((s) => s.id === snippet.id)
    save(exists ? snippets.map((s) => (s.id === snippet.id ? snippet : s)) : [...snippets, snippet])
    setEditing(null)
  }

  const remove = (id: string): void => save(snippets.filter((s) => s.id !== id))

  if (editing) {
    return (
      <Modal title="Snippet" onClose={() => setEditing(null)} width={560}>
        <SnippetForm
          snippet={editing}
          onCancel={() => setEditing(null)}
          onSave={commit}
        />
      </Modal>
    )
  }

  return (
    <Modal title={`Snippets · ${server.name}`} onClose={onClose} width={560}>
      <div className="space-y-2">
        {snippets.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-faint">
            No snippets yet. Save the commands you keep retyping on this host.
          </p>
        )}

        {snippets.map((s) => (
          <div
            key={s.id}
            className="group flex items-start gap-2 rounded-lg border border-line bg-bg-elevated px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold">{s.name}</span>
                {s.autoRun && (
                  <span
                    title="Runs immediately"
                    className="flex items-center gap-0.5 rounded bg-accent-dim px-1 py-px text-[10px] font-semibold text-accent-hover"
                  >
                    <Zap size={9} /> run
                  </span>
                )}
              </div>
              <pre className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{s.command}</pre>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {onRun && (
                <IconAction title="Send to terminal" onClick={() => onRun(s)}>
                  <Play size={13} />
                </IconAction>
              )}
              <IconAction title="Edit" onClick={() => setEditing(s)}>
                <Pencil size={13} />
              </IconAction>
              <IconAction title="Delete" danger onClick={() => remove(s.id)}>
                <Trash2 size={13} />
              </IconAction>
            </div>
          </div>
        ))}

        <Button
          variant="ghost"
          className="w-full"
          onClick={() =>
            setEditing({ id: newId(), name: '', command: '', autoRun: false, createdAt: Date.now() })
          }
        >
          <Plus size={14} /> New snippet
        </Button>
      </div>
    </Modal>
  )
}

function SnippetForm({
  snippet,
  onSave,
  onCancel
}: {
  snippet: Snippet
  onSave: (s: Snippet) => void
  onCancel: () => void
}): ReactNode {
  const [name, setName] = useState(snippet.name)
  const [command, setCommand] = useState(snippet.command)
  const [autoRun, setAutoRun] = useState(!!snippet.autoRun)

  const valid = name.trim().length > 0 && command.trim().length > 0

  return (
    <div className="space-y-3.5">
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          placeholder="Restart the API"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Command" hint="Multiple lines are sent as written, one line at a time.">
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder="sudo systemctl restart api"
          className="field-input min-h-[84px] resize-y font-mono text-[12px]"
        />
      </Field>

      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={autoRun}
          onChange={(e) => setAutoRun(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-accent"
        />
        <span>
          Run immediately
          <span className="block text-[11px] text-ink-faint">
            Off by default: the command is typed into the prompt so you can read it before pressing
            Enter.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          <ChevronLeft size={14} /> Back
        </Button>
        <Button
          disabled={!valid}
          onClick={() => onSave({ ...snippet, name: name.trim(), command, autoRun })}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function IconAction({
  title,
  onClick,
  danger,
  children
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-bg-hover',
        danger ? 'hover:text-bad' : 'hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}
