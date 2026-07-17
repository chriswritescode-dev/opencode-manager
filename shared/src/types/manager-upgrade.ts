export type ManagerUpgradeJobStatus = 'pending' | 'pulling' | 'recreating' | 'completed' | 'failed'

export type ManagerUpgradeStrategy = 'pull' | 'build'

export interface ManagerUpgradeJob {
  id: number
  status: ManagerUpgradeJobStatus
  fromVersion: string | null
  toVersion: string | null
  targetImage: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export interface ManagerUpgradeStatusResponse {
  supported: boolean
  inDocker: boolean
  socketAvailable: boolean
  enabled: boolean
  strategy: ManagerUpgradeStrategy
  currentVersion: string | null
  job: ManagerUpgradeJob | null
}
