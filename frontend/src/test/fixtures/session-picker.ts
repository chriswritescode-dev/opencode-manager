import type { Repo, Session } from '@/api/types'

export function makeSession(id: string, title: string, directory: string, updated = Date.now()): Session {
  return {
    id,
    projectID: 'proj',
    title,
    time: { created: updated, updated },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

export function makeRepo(id: number, name: string, fullPath: string): Repo {
  return {
    id,
    name,
    localPath: fullPath,
    fullPath,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
  }
}
