import type { Database } from 'bun:sqlite'
import { DEFAULT_DEV_SERVER_PORT, type DevServerState } from '@opencode-manager/shared/types'
import { SettingsService } from '../settings'
import { isPortOpen } from './ports'

export function getDevServerPort(db: Database): number {
  const port = new SettingsService(db).getSettings('default').preferences.devServerPort
  return port ?? DEFAULT_DEV_SERVER_PORT
}

export async function getDevServerState(db: Database, repoId: number): Promise<DevServerState> {
  const port = getDevServerPort(db)
  const isRunning = await isPortOpen(port)

  return {
    repoId,
    status: isRunning ? 'running' : 'stopped',
    port,
    error: isRunning ? null : `No dev server detected on localhost:${port}`,
    previewPath: isRunning ? `/api/dev-proxy/${repoId}/` : null,
  }
}
