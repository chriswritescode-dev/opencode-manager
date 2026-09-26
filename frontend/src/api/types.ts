export interface Repo {
  id: number
  name?: string
  repoUrl?: string
  localPath: string
  fullPath: string
  sourcePath?: string
  branch?: string
  currentBranch?: string
  defaultBranch: string
  cloneStatus: 'cloning' | 'ready' | 'error'
  clonedAt: number
  lastPulled?: number
  lastAccessedAt?: number
  gitCredentialId?: string
  isWorktree?: boolean
  isLocal?: boolean
}

import type { SessionInfo } from '@opencode-manager/shared/opencode'

export type Session = SessionInfo
export type PermissionResponse = 'once' | 'always' | 'reject'

export interface FileAttachmentInfo {
  path: string
  name: string
  mime?: string
}

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export interface SSHHostKeyRequest {
  id: string
  requestId: string
  host: string
  ip?: string
  keyType: string
  fingerprint: string
  isKeyChanged?: boolean
  timestamp: number
  action: 'verify'
}
