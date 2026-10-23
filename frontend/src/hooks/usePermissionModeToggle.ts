import { useSessionPermissionMode, useSetSessionPermissionMode } from '@/hooks/useSessionPermissionMode'

export function usePermissionModeToggle(
  sessionID: string,
  directory: string,
  options: { enabled?: boolean } = {},
) {
  const { data, isError } = useSessionPermissionMode(sessionID, options)
  const setMode = useSetSessionPermissionMode(sessionID)

  const loaded = data !== undefined
  const isAuto = data?.mode === 'auto'
  const lockedReason = data?.lockedReason ?? null
  const disabled = !loaded || lockedReason !== null || setMode.isPending

  const label = !loaded
    ? isError
      ? 'Permissions: unavailable'
      : 'Permissions: loading'
    : lockedReason === 'child'
      ? 'Inherited from parent session'
      : lockedReason === 'schedule'
        ? "Scheduled runs use the schedule's permission configuration"
        : isAuto
          ? 'Permissions: auto-accept all'
          : 'Permissions: follow configured rules'

  const toggle = () => {
    if (disabled) return
    setMode.mutate({ directory, mode: isAuto ? 'ask' : 'auto' })
  }

  return { isAuto, disabled, label, toggle }
}
