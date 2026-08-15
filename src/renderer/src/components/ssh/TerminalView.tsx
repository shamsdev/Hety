import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RotateCw, Zap } from 'lucide-react'
import type { Server, Snippet } from '@shared/types'
import { StatusDot, cn } from '../../lib/ui'
import { useApp } from '../../store'
import SnippetPicker from './SnippetPicker'
import SnippetsDialog from './SnippetsDialog'

type Status = 'connecting' | 'connected' | 'closed' | 'error'

const STATUS_COLOR: Record<Status, string> = {
  connecting: '#e0b341',
  connected: '#46c08a',
  closed: '#646b78',
  error: '#e0625e'
}

export default function TerminalView({
  server,
  projectId,
  liveKey,
  active
}: {
  server: Server
  projectId: string
  liveKey: string
  active: boolean
}): ReactNode {
  const setLive = useApp((s) => s.setLive)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idRef = useRef<string | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState('')
  const [generation, setGeneration] = useState(0)
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const [managing, setManaging] = useState(false)

  // Read the server back out of the store: the tab captured it when the session
  // opened, so edits (including new snippets) wouldn't otherwise show up here.
  const liveServer = useApp(
    (s) => s.data.projects.find((p) => p.id === projectId)?.servers.find((x) => x.id === server.id)
  )
  const current = liveServer ?? server
  const snippets = current.snippets ?? []

  useEffect(() => {
    setLive('ssh', projectId, liveKey, status === 'connected')
    return () => setLive('ssh', projectId, liveKey, false)
  }, [status, projectId, liveKey, setLive])

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0e0f13',
        foreground: '#d6d9e0',
        cursor: '#6d8cff',
        selectionBackground: '#26304f',
        black: '#2a2e37',
        red: '#e0625e',
        green: '#46c08a',
        yellow: '#e0b341',
        blue: '#6d8cff',
        magenta: '#b07ee6',
        cyan: '#56c7d6',
        white: '#d6d9e0',
        brightBlack: '#646b78',
        brightRed: '#ff7b76',
        brightGreen: '#5fd6a0',
        brightYellow: '#f0c861',
        brightBlue: '#8aa1ff',
        brightMagenta: '#c79bf0',
        brightCyan: '#74dbe8',
        brightWhite: '#ffffff'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

    // Ctrl+Shift+C copies the selection; Ctrl+Shift+V pastes. Plain Ctrl+C still sends SIGINT.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.code === 'KeyC') {
          const sel = term.getSelection()
          if (sel) void navigator.clipboard.writeText(sel)
          return false
        }
        if (e.code === 'KeyV') {
          // Don't paste here: returning false stops xterm from emitting a
          // literal ^V, and the browser's native paste event still fires once
          // and feeds the clipboard through term.onData. Reading the clipboard
          // ourselves on top of that pasted the text twice.
          return false
        }
      }
      return true
    })
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    termRef.current = term
    fitRef.current = fit

    setStatus('connecting')
    setMessage('')

    const offData = window.api.ssh.onData((p) => {
      if (p.id === idRef.current) term.write(p.data)
    })
    const offStatus = window.api.ssh.onStatus((p) => {
      if (p.id !== idRef.current) return
      setStatus(p.status)
      if (p.message) setMessage(p.message)
      if (p.status === 'connected') term.focus()
    })

    window.api.ssh
      .open(server, term.cols, term.rows)
      .then((id) => {
        idRef.current = id
      })
      .catch((e: Error) => {
        setStatus('error')
        setMessage(e.message)
      })

    const dataDisposable = term.onData((data) => {
      if (idRef.current) window.api.ssh.input(idRef.current, data)
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        if (idRef.current) window.api.ssh.resize(idRef.current, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    })
    ro.observe(hostRef.current)

    return () => {
      offData()
      offStatus()
      dataDisposable.dispose()
      ro.disconnect()
      if (idRef.current) window.api.ssh.close(idRef.current)
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  // Re-fit when this tab becomes active (it had zero size while hidden).
  useEffect(() => {
    if (!active) return
    const t = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        termRef.current?.focus()
        if (idRef.current && termRef.current)
          window.api.ssh.resize(idRef.current, termRef.current.cols, termRef.current.rows)
      } catch {
        /* ignore */
      }
    })
    return () => cancelAnimationFrame(t)
  }, [active])

  const reconnect = (): void => {
    if (idRef.current) window.api.ssh.close(idRef.current)
    idRef.current = null
    setGeneration((g) => g + 1)
  }

  /** Type a snippet at the prompt, pressing Enter only when it opted in. */
  const send = (snippet: Snippet): void => {
    const id = idRef.current
    if (!id) return
    // A shell consumes CR as "execute this line", which is what typing the text
    // by hand would do too.
    const text = snippet.command.replace(/\r?\n/g, '\r')
    window.api.ssh.input(id, snippet.autoRun && !text.endsWith('\r') ? text + '\r' : text)
    termRef.current?.focus()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-3 py-1.5">
        {server.color && (
          <span className="h-3.5 w-1 rounded-full" style={{ background: server.color }} />
        )}
        <StatusDot color={STATUS_COLOR[status]} />
        <span className="text-xs text-ink-soft">
          {status === 'connected'
            ? `${server.username}@${server.host}`
            : status === 'connecting'
              ? `Connecting to ${server.host}…`
              : status === 'error'
                ? `Error: ${message}`
                : 'Disconnected'}
        </span>
        <button
          className={cn(
            'ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold',
            status === 'connected'
              ? 'text-ink-soft hover:bg-bg-hover hover:text-ink'
              : 'cursor-not-allowed text-ink-faint opacity-50'
          )}
          title="Saved commands for this server"
          disabled={status !== 'connected'}
          onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
        >
          <Zap size={12} /> Snippets
          {snippets.length > 0 && <span className="text-ink-faint">{snippets.length}</span>}
        </button>
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-bg-hover hover:text-ink"
          onClick={reconnect}
        >
          <RotateCw size={12} /> Reconnect
        </button>
      </div>

      {pickerAnchor && (
        <SnippetPicker
          anchor={pickerAnchor}
          snippets={snippets}
          onPick={send}
          onManage={() => setManaging(true)}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      {managing && (
        <SnippetsDialog
          projectId={projectId}
          server={current}
          onRun={status === 'connected' ? send : undefined}
          onClose={() => setManaging(false)}
        />
      )}
      <div
        ref={hostRef}
        className="min-h-0 flex-1 bg-bg-base"
        onContextMenu={(e) => {
          // Right-click pastes the clipboard into the session (in addition to Ctrl+Shift+V).
          e.preventDefault()
          void navigator.clipboard.readText().then((text) => {
            if (text && idRef.current) window.api.ssh.input(idRef.current, text)
          })
        }}
      />
    </div>
  )
}
