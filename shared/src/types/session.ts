export type SessionStatus = 'creating' | 'running' | 'stale' | 'stopped' | 'error'

export interface RepoMapping {
  repoId: number
  repoName: string
  worktreePath: string
  symlinkPath: string
  containerPath: string
  branch?: string
}

export interface Session {
  id: string
  name: string
  repoMappings: RepoMapping[]
  status: SessionStatus
  
  opencodeContainerId: string | null
  dindContainerId: string | null
  codeServerContainerId: string | null
  
  internalHostname: string
  opencodeUrl: string
  codeServerUrl: string
  publicOpencodeUrl?: string
  
  sessionPath: string
  opencodeStatePath: string
  dindDataPath: string
  codeServerConfigPath: string
  
  devcontainerTemplate: string
  devcontainerConfigHash: string
  
  createdAt: number
  lastActiveAt: number
  metadata: Record<string, any>
}

export interface CreateSessionInput {
  name: string
  repos: Array<{
    repoId: number
    branch?: string
  }>
  devcontainerTemplate?: string
  enablePublicAccess?: boolean
  metadata?: Record<string, any>
}

export interface DevcontainerConfig {
  name: string
  version?: string
  description?: string
  build: {
    dockerfile: string
    context: string
    args: {
      NIX_PACKAGES: string
      [key: string]: string
    }
  }
  containerEnv?: Record<string, string>
  mounts?: string[]
  postCreateCommand?: string
  remoteUser?: string
  customizations?: {
    vscode?: {
      extensions?: string[]
      settings?: Record<string, any>
    }
  }
  metadata?: {
    tags?: string[]
    author?: string
    createdAt?: string
    forkedFrom?: string | null
  }
}

export interface DevcontainerTemplate {
  name: string
  config: DevcontainerConfig
  dockerfile?: string
  forkedFrom?: string | null
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
  metadata?: Record<string, any>
}

export interface CreateDevcontainerTemplateInput {
  name: string
  config: DevcontainerConfig
  dockerfile?: string
  basedOn?: string
}

export interface DevcontainerChanges {
  addNixPackages?: string[]
  removeNixPackages?: string[]
  addEnv?: Record<string, string>
  removeEnv?: string[]
  addMounts?: string[]
  customChanges?: Record<string, any>
}

export interface DevcontainerUpdateRequest {
  sessionId: string
  templateName?: string
  requestedBy: string
  changes: DevcontainerChanges
  reason?: string
  action?: 'modify' | 'fork'
  status: 'pending' | 'approved' | 'applied' | 'rejected'
  createdAt: number
}

export interface ContainerStatus {
  id: string
  name: string
  state: 'running' | 'stopped' | 'exited' | 'created'
  health?: 'healthy' | 'unhealthy' | 'starting'
  uptime?: number
}

export interface SessionDetail extends Session {
  containers: {
    opencode?: ContainerStatus
    dind?: ContainerStatus
    codeServer?: ContainerStatus
  }
  repos: RepoMapping[]
}
