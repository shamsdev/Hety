import { useCallback, useState, type MouseEvent as REMouseEvent, type ReactNode } from 'react'
import { cn } from './ui'

/** Persisted pixel size for a resizable layout section. */
export function usePersistedSize(
  key: string,
  fallback: number,
  min: number,
  max: number
): [number, (n: number) => void] {
  const storageKey = `hety.layout.${key}`
  const [size, setSize] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw != null) {
        const n = Number(raw)
        if (Number.isFinite(n)) return Math.min(max, Math.max(min, n))
      }
    } catch {
      /* ignore */
    }
    return fallback
  })

  const set = useCallback(
    (n: number) => {
      const clamped = Math.min(max, Math.max(min, Math.round(n)))
      setSize(clamped)
      try {
        localStorage.setItem(storageKey, String(clamped))
      } catch {
        /* ignore */
      }
    },
    [storageKey, min, max]
  )

  return [size, set]
}

/** Drag handle between flex panels. Takes no layout space — overlays the shared edge. */
export function ResizeHandle({
  axis,
  size,
  onResize,
  inverted,
  className
}: {
  axis: 'x' | 'y'
  size: number
  onResize: (next: number) => void
  inverted?: boolean
  className?: string
}): ReactNode {
  const onMouseDown = (e: REMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const start = axis === 'x' ? e.clientX : e.clientY
    const startSize = size

    const move = (ev: MouseEvent): void => {
      const cur = axis === 'x' ? ev.clientX : ev.clientY
      const delta = inverted ? start - cur : cur - start
      onResize(startSize + delta)
    }
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      className={cn('relative z-20 shrink-0', axis === 'x' ? 'w-0' : 'h-0', className)}
    >
      <div
        onMouseDown={onMouseDown}
        className={cn(
          'absolute bg-transparent transition-colors hover:bg-accent/40 active:bg-accent/60',
          axis === 'x'
            ? 'inset-y-0 -left-1 w-2 cursor-col-resize'
            : 'inset-x-0 -top-1 h-2 cursor-row-resize'
        )}
      />
    </div>
  )
}
