import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface TempWorkspace {
  path: string
  restore: () => void
}

export function applyTestEnv(overrides: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

export function createTempWorkspace(prefix = 'ocm-workspace-'): TempWorkspace {
  const workspacePath = mkdtempSync(path.join(tmpdir(), prefix))
  const restoreEnv = applyTestEnv({ WORKSPACE_PATH: workspacePath })
  return {
    path: workspacePath,
    restore: () => {
      restoreEnv()
      rmSync(workspacePath, { recursive: true, force: true })
    },
  }
}
