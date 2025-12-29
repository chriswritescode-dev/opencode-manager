export interface Repo {
  id: number
  repoUrl: string
  localPath: string
  fullPath: string
  branch?: string
  currentBranch?: string
  defaultBranch: string
  cloneStatus: 'cloning' | 'ready' | 'error'
  clonedAt: number
  lastPulled?: number
  openCodeConfigName?: string
  isWorktree?: boolean
}

import type { components } from './opencode-types'

export type Message = components['schemas']['Message']
export type Part = components['schemas']['Part']
export type Session = components['schemas']['Session']
export type Permission = components['schemas']['Permission']
export type PermissionResponse = 'once' | 'always' | 'reject'

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

export type MessageListResponse = MessageWithParts[]

export interface SSEMessagePartUpdatedEvent {
  type: 'message.part.updated' | 'messagev2.part.updated'
  properties: {
    part: Part
  }
}

export interface SSEMessageUpdatedEvent {
  type: 'message.updated' | 'messagev2.updated'
  properties: {
    info: Message
  }
}

export interface SSEMessageRemovedEvent {
  type: 'message.removed' | 'messagev2.removed'
  properties: {
    sessionID: string
    messageID: string
  }
}

export interface SSEMessagePartRemovedEvent {
  type: 'message.part.removed' | 'messagev2.part.removed'
  properties: {
    sessionID: string
    messageID: string
    partID: string
  }
}

export interface SSESessionUpdatedEvent {
  type: 'session.updated'
  properties: {
    info: Session
  }
}

export interface SSESessionDeletedEvent {
  type: 'session.deleted'
  properties: {
    sessionID: string
  }
}

export interface SSESessionCompactedEvent {
  type: 'session.compacted'
  properties: {
    sessionID: string
  }
}

export interface SSETodoUpdatedEvent {
  type: 'todo.updated'
  properties: {
    sessionID: string
    todos: components['schemas']['Todo'][]
  }
}

export interface SSEPermissionUpdatedEvent {
  type: 'permission.updated'
  properties: Permission
}

export interface SSEPermissionRepliedEvent {
  type: 'permission.replied'
  properties: {
    sessionID: string
    permissionID: string
    response: string
  }
}

export interface SSEInstallationUpdatedEvent {
  type: 'installation.updated'
  properties: {
    version: string
  }
}

export interface SSEInstallationUpdateAvailableEvent {
  type: 'installation.update-available'
  properties: {
    version: string
  }
}

export interface SSESessionIdleEvent {
  type: 'session.idle'
  properties: {
    sessionID: string
  }
}

export interface SSESessionStatusEvent {
  type: 'session.status'
  properties: {
    sessionID: string
    status: {
      type: 'idle'
    } | {
      type: 'busy'
    } | {
      type: 'retry'
      attempt: number
      message: string
      next: number
    }
  }
}

export type SSEEvent =
  | SSEMessagePartUpdatedEvent
  | SSEMessageUpdatedEvent
  | SSEMessageRemovedEvent
  | SSEMessagePartRemovedEvent
  | SSESessionUpdatedEvent
  | SSESessionDeletedEvent
  | SSESessionCompactedEvent
  | SSESessionIdleEvent
  | SSESessionStatusEvent
  | SSETodoUpdatedEvent
  | SSEPermissionUpdatedEvent
  | SSEPermissionRepliedEvent
  | SSEInstallationUpdatedEvent
  | SSEInstallationUpdateAvailableEvent

export type ContentPart = 
  | { type: 'text', content: string }
  | { type: 'file', path: string, name: string }
  | { type: 'image', id: string, filename: string, mime: string, dataUrl: string }

export interface FileInfo {
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
