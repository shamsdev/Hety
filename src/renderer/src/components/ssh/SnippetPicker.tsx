import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Settings2, Zap } from 'lucide-react'
import type { Snippet } from '@shared/types'
import { matchCommand } from '../../lib/fuzzy'
import { AnchorMenu, cn } from '../../lib/ui'

/** Searchable popover listing a server's snippets. */
export default function SnippetPicker({
  anchor,
  snippets,
  onPick,
  onManage,
  onClose
}: {
  anchor: { top: number; bottom: number; left: number; right: number }
  snippets: Snippet[]
  onPick: (s: Snippet) => void
  onManage: () => void
  onClose: () => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({
      block: 'nearest'
    })
  }, [index])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return snippets
    return snippets
      .map((s) => ({ s, m: matchCommand(q, s.name, s.command) }))
      .filter((x): x is { s: Snippet; m: NonNullable<typeof x.m> } => x.m !== null)
      .sort((a, b) => b.m.score - a.m.score)
      .map((x) => x.s)
  }, [snippets, query])

  const pick = (s: Snippet | undefined): void => {
    if (!s) return
    onPick(s)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <AnchorMenu anchor={anchor} onClose={onClose} width={340}>
      <div className="border-b border-line px-2 pb-1.5 pt-1">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Filter snippets…"
          className="w-full bg-transparent px-1 py-1 text-[12px] outline-none placeholder:text-ink-faint"
        />
      </div>

      <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
        {results.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-ink-faint">
            {snippets.length === 0 ? 'No snippets for this server yet.' : 'No matches.'}
          </div>
        )}
        {results.map((s, i) => (
          <button
            key={s.id}
            data-idx={i}
            onMouseMove={() => setIndex(i)}
            onClick={() => pick(s)}
            className={cn(
              'block w-full px-3 py-1.5 text-left',
              i === index ? 'bg-accent-dim' : 'hover:bg-bg-hover'
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-semibold text-ink">{s.name}</span>
              {s.autoRun && <Zap size={10} className="shrink-0 text-accent" />}
            </span>
            <span className="block truncate font-mono text-[10px] text-ink-faint">{s.command}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          onManage()
          onClose()
        }}
        className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-[12px] text-ink-soft hover:bg-bg-hover hover:text-ink"
      >
        <Settings2 size={13} /> Manage snippets…
      </button>
    </AnchorMenu>
  )
}
