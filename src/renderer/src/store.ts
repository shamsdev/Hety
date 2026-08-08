import { create } from 'zustand'
import type { AppData, Project, Server, Database, SavedQuery } from '@shared/types'
import { emptyAppData } from '@shared/types'
import { normalizeAppData } from './lib/projects'

export function newId(): string {
  return crypto.randomUUID()
}

type LiveKind = 'ssh' | 'db'

interface AppState {
  ready: boolean
  data: AppData
  selectedProjectId: string | null
  /** Projects whose Workspace stays mounted so SSH/DB sessions survive switching. */
  openProjectIds: string[]
  /** Live connection keys keyed by project id (ssh sessions / db connections). */
  liveSsh: Record<string, string[]>
  liveDb: Record<string, string[]>
  load: (data: AppData) => void
  selectProject: (id: string | null) => void
  upsertProject: (p: Project) => void
  deleteProject: (id: string) => void
  upsertServer: (projectId: string, s: Server) => void
  deleteServer: (projectId: string, id: string) => void
  upsertDatabase: (projectId: string, d: Database) => void
  deleteDatabase: (projectId: string, id: string) => void
  addSavedQuery: (q: SavedQuery) => void
  deleteSavedQuery: (id: string) => void
  setLive: (kind: LiveKind, projectId: string, key: string, live: boolean) => void
}

function persist(data: AppData): void {
  void window.api.store.save(data)
}

function mapProjects(
  data: AppData,
  projectId: string,
  fn: (p: Project) => Project
): Project[] {
  return data.projects.map((p) => (p.id === projectId ? fn(p) : p))
}

function patchLive(
  map: Record<string, string[]>,
  projectId: string,
  key: string,
  live: boolean
): Record<string, string[]> {
  const cur = map[projectId] ?? []
  const has = cur.includes(key)
  if (live && has) return map
  if (!live && !has) return map
  const next = live ? [...cur, key] : cur.filter((k) => k !== key)
  if (next.length === 0) {
    const { [projectId]: _, ...rest } = map
    return rest
  }
  return { ...map, [projectId]: next }
}

export function projectHasLive(
  liveSsh: Record<string, string[]>,
  liveDb: Record<string, string[]>,
  projectId: string
): boolean {
  return (liveSsh[projectId]?.length ?? 0) > 0 || (liveDb[projectId]?.length ?? 0) > 0
}

/** Stable empty list for zustand selectors — never return a fresh `[]` from getSnapshot. */
export const EMPTY_LIVE: string[] = []

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  data: emptyAppData(),
  selectedProjectId: null,
  openProjectIds: [],
  liveSsh: {},
  liveDb: {},

  load: (data) => set({ data: normalizeAppData(data), ready: true }),

  selectProject: (id) => {
    if (id) {
      const open = get().openProjectIds
      // Only bump lastOpenedAt when first opening a project this session —
      // switching back to an already-open project must not reshuffle Recents.
      if (!open.includes(id)) {
        const data = {
          ...get().data,
          projects: mapProjects(get().data, id, (p) => ({ ...p, lastOpenedAt: Date.now() }))
        }
        set({ data, selectedProjectId: id, openProjectIds: [...open, id] })
        persist(data)
      } else {
        set({ selectedProjectId: id })
      }
    } else {
      set({ selectedProjectId: null })
    }
  },

  upsertProject: (p) => {
    const cur = get().data
    const exists = cur.projects.some((x) => x.id === p.id)
    const projects = exists
      ? cur.projects.map((x) => (x.id === p.id ? p : x))
      : [...cur.projects, p]
    const data = { ...cur, projects }
    set({ data })
    persist(data)
  },

  deleteProject: (id) => {
    const cur = get().data
    const data = {
      ...cur,
      projects: cur.projects.filter((p) => p.id !== id),
      savedQueries: cur.savedQueries.filter((q) => q.projectId !== id)
    }
    const { [id]: _s, ...liveSsh } = get().liveSsh
    const { [id]: _d, ...liveDb } = get().liveDb
    set({
      data,
      selectedProjectId: get().selectedProjectId === id ? null : get().selectedProjectId,
      openProjectIds: get().openProjectIds.filter((x) => x !== id),
      liveSsh,
      liveDb
    })
    persist(data)
  },

  upsertServer: (projectId, s) => {
    const data = {
      ...get().data,
      projects: mapProjects(get().data, projectId, (p) => {
        const exists = p.servers.some((x) => x.id === s.id)
        return {
          ...p,
          servers: exists ? p.servers.map((x) => (x.id === s.id ? s : x)) : [...p.servers, s]
        }
      })
    }
    set({ data })
    persist(data)
  },

  deleteServer: (projectId, id) => {
    const data = {
      ...get().data,
      projects: mapProjects(get().data, projectId, (p) => ({
        ...p,
        servers: p.servers.filter((x) => x.id !== id)
      }))
    }
    set({ data })
    persist(data)
  },

  upsertDatabase: (projectId, d) => {
    const data = {
      ...get().data,
      projects: mapProjects(get().data, projectId, (p) => {
        const exists = p.databases.some((x) => x.id === d.id)
        return {
          ...p,
          databases: exists ? p.databases.map((x) => (x.id === d.id ? d : x)) : [...p.databases, d]
        }
      })
    }
    set({ data })
    persist(data)
  },

  deleteDatabase: (projectId, id) => {
    const data = {
      ...get().data,
      projects: mapProjects(get().data, projectId, (p) => ({
        ...p,
        databases: p.databases.filter((x) => x.id !== id)
      })),
      savedQueries: get().data.savedQueries.filter((q) => q.databaseId !== id)
    }
    set({ data })
    persist(data)
  },

  addSavedQuery: (q) => {
    const data = { ...get().data, savedQueries: [q, ...get().data.savedQueries] }
    set({ data })
    persist(data)
  },

  deleteSavedQuery: (id) => {
    const data = {
      ...get().data,
      savedQueries: get().data.savedQueries.filter((q) => q.id !== id)
    }
    set({ data })
    persist(data)
  },

  setLive: (kind, projectId, key, live) => {
    if (kind === 'ssh') {
      set({ liveSsh: patchLive(get().liveSsh, projectId, key, live) })
    } else {
      set({ liveDb: patchLive(get().liveDb, projectId, key, live) })
    }
  }
}))
