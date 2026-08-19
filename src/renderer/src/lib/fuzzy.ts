const SEPARATORS = new Set([' ', '-', '_', '.', '/', '\\', ':', '@', '(', ')', '[', ']', ','])

export interface FuzzyResult {
  score: number
  /** Indices into the original text that matched, for highlighting. */
  positions: number[]
}

/** True when `i` starts a new word: first char, after a separator, or a camelCase hump. */
function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  if (SEPARATORS.has(prev)) return true
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(text[i])
}

/**
 * Match `query` against `text` as a subsequence, scoring boundary hits and
 * consecutive runs highest. Returns null when the characters aren't all there.
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }
  if (query.length > text.length) return null

  const lower = text.toLowerCase()
  const q = query.toLowerCase()

  // A contiguous hit always beats a scattered one, so check for it first.
  const direct = lower.indexOf(q)
  if (direct >= 0) {
    const positions: number[] = []
    for (let i = 0; i < q.length; i++) positions.push(direct + i)
    let score = 100 + q.length * 4 - Math.min(direct, 30)
    if (direct === 0) score += 50
    else if (isBoundary(text, direct)) score += 25
    return { score, positions }
  }

  const positions: number[] = []
  let score = 0
  let at = 0
  let prev = -2

  for (const ch of q) {
    let found = -1
    while (at < lower.length) {
      if (lower[at] === ch) {
        found = at
        break
      }
      at++
    }
    if (found < 0) return null

    let bonus = 1
    if (isBoundary(text, found)) bonus += 12
    if (found === prev + 1) bonus += 8
    score += bonus
    positions.push(found)
    prev = found
    at++
  }

  // Prefer matches that start early in the text.
  return { score: score - Math.min(positions[0], 20), positions }
}

export interface CommandMatch {
  score: number
  /** Highlight positions in the title; empty when only the context text matched. */
  positions: number[]
}

/**
 * Score a palette entry. A hit in the title outranks one in the surrounding
 * context (host, project name, tags), so typing a server name doesn't surface
 * every item that merely lives in a similarly named project.
 */
export function matchCommand(query: string, title: string, context?: string): CommandMatch | null {
  const inTitle = fuzzyMatch(title, query)
  if (inTitle) return { score: inTitle.score + 200, positions: inTitle.positions }
  if (context) {
    const inContext = fuzzyMatch(context, query)
    if (inContext) return { score: inContext.score, positions: [] }
  }
  return null
}
