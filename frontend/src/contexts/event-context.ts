import { createContext, useContext } from 'react'
import type { SSHHostKeyRequest } from '@opencode-manager/shared/schemas'
import type { FormAnswer, FormInfo, PermissionReply, PermissionRequest } from '@opencode-manager/shared/opencode'
import type { EventStreamHealthState } from '@/lib/opencode-event-stream'
import { useSessionStatus } from '@/stores/sessionStatusStore'

type ServerScoped<T> = T & { serverId: string }

export type PendingPermission = ServerScoped<PermissionRequest>
export type PendingForm = ServerScoped<FormInfo>
export type SSEHealthState = Pick<EventStreamHealthState, 'isConnected' | 'isHealthy' | 'isStalled'>

interface SSHHostKeyState {
  request: SSHHostKeyRequest | null
  respond: (requestId: string, approved: boolean) => Promise<void>
}

export interface EventContextValue {
  sshHostKey: SSHHostKeyState
  permissions: {
    current: PendingPermission | null
    pendingCount: number
    pendingSessionIDs: string[]
    viewedSessionId: string | null
    currentDirectory: string | null
    currentIsFromDifferentSession: boolean
    respond: (
      permissionID: string,
      sessionID: string,
      response: PermissionReply,
      message?: string,
    ) => Promise<void>
    dismiss: (permissionID: string, sessionID?: string) => void
    getForToolCall: (toolCallID: string, messageID?: string) => PermissionRequest | null
    hasForSession: (sessionID: string) => boolean
    showDialog: boolean
    setShowDialog: (show: boolean) => void
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string, serverId?: string) => Promise<void>
  }
  forms: {
    current: PendingForm | null
    pendingCount: number
    pendingSessionIDs: string[]
    reply: (formID: string, answer: FormAnswer) => Promise<void>
    cancel: (formID: string) => Promise<void>
    dismiss: (formID: string, sessionID?: string) => void
    getForSession: (sessionID: string) => FormInfo | null
    hasForSession: (sessionID: string) => boolean
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string, serverId?: string) => Promise<void>
    forgetPendingActionsForSession: (sessionID: string) => void
  }
  sseHealth: SSEHealthState
  getRepoIdForSession: (sessionID: string) => number | null
}

export const EventContext = createContext<EventContextValue | null>(null)

export function useEventContext(): EventContextValue {
  const context = useContext(EventContext)
  if (!context) {
    throw new Error('useEventContext must be used within EventProvider')
  }
  return context
}

export function usePermissions(): EventContextValue['permissions'] {
  const { permissions } = useEventContext()
  return permissions
}

export function useToolCallPermission(
  toolCallID: string,
  messageID?: string,
): PermissionRequest | null {
  const context = useContext(EventContext)
  return context?.permissions.getForToolCall(toolCallID, messageID) ?? null
}

export function useForms(): EventContextValue['forms'] {
  const { forms } = useEventContext()
  return forms
}

export function useSSEHealth(): SSEHealthState {
  return useEventContext().sseHealth
}

export function selectActiveSessionDirectoriesKey(
  state: Pick<ReturnType<typeof useSessionStatus.getState>, 'statuses' | 'directories' | 'runningShells'>,
): string {
  const directories = new Set<string>()
  for (const [sessionID, status] of state.statuses.entries()) {
    if (status.type === 'idle') continue
    const directory = state.directories.get(sessionID)
    if (directory) directories.add(directory)
  }
  for (const shell of state.runningShells.values()) {
    if (shell.directory) directories.add(shell.directory)
  }
  return [...directories].sort().join('\n')
}
