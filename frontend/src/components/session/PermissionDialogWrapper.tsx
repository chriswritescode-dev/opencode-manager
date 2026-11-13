import { useQuery } from '@tanstack/react-query'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { PermissionRequestDialog } from '@/components/session/PermissionRequestDialog'
import { isLocalOpenCodeServer } from '@/contexts/opencode-server-context'
import { useEventContext, usePermissions } from '@/contexts/event-context'
import { sessionQueryOptions } from '@/hooks/useOpenCode'

export function PermissionDialogWrapper() {
  const {
    current: currentPermission,
    pendingCount,
    respond: replyToPermission,
    showDialog,
    setShowDialog,
    navigateToCurrent,
    viewedSessionId,
    currentDirectory,
    currentIsFromDifferentSession,
  } = usePermissions()
  const { getRepoIdForSession } = useEventContext()
  const isRemotePermission = currentPermission !== null && !isLocalOpenCodeServer(currentPermission.serverId)
  const { data: session } = useQuery(
    sessionQueryOptions(
      currentPermission?.sessionID,
      currentDirectory ?? undefined,
      currentPermission?.serverId ?? LOCAL_OPENCODE_SERVER_ID,
    ),
  )

  const canOpenCurrentSession = currentPermission !== null
    && (isRemotePermission || getRepoIdForSession(currentPermission.sessionID) !== null)
    && (currentIsFromDifferentSession || viewedSessionId === null)

  return (
    <PermissionRequestDialog
      permission={currentPermission}
      pendingCount={pendingCount}
      isFromDifferentSession={currentIsFromDifferentSession}
      sessionTitle={session?.title ?? undefined}
      repoDirectory={currentDirectory}
      onOpenSession={canOpenCurrentSession ? navigateToCurrent : undefined}
      onRespond={replyToPermission}
      open={showDialog}
      onOpenChange={setShowDialog}
    />
  )
}
