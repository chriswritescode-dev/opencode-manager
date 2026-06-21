export const DEFAULT_DEV_SERVER_PORT = 3055

export type DevServerStatus = 'running' | 'stopped'

export interface DevServerState {
  repoId: number
  status: DevServerStatus
  port: number
  error: string | null
  previewPath: string | null
}

export interface DevServerConfig {
  injectBase: boolean
}
