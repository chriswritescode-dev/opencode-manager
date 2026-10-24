import type { Repo, Session } from '@/api/types'

/**
 * Builds a session fixture for picker tests.
 *
 * @param id Session id.
 * @param title Session title.
 * @param directory Session working directory.
 * @param updated Session creation and update timestamp.
 */
export function makeSession(id: string, title: string, directory: string, updated = Date.now()): Session {
  return {
    id,
    projectID: 'proj',
    title,
    time: { created: updated, updated },
    location: { directory },
    cost: 0,
    tokens: {},
  } as unknown as Session
}

/**
 * Builds a ready repo fixture for picker tests.
 *
 * @param id Repo id.
 * @param name Repo name.
 * @param fullPath Repo working directory.
 */
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
