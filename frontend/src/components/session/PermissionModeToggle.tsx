import { Shield, ShieldCheck } from 'lucide-react'
import { useSessionPermissionMode, useSetSessionPermissionMode } from '@/hooks/useSessionPermissionMode'
import { IconToggleButton } from '@/components/ui/icon-toggle-button'

interface PermissionModeToggleProps {
  sessionID: string
  directory: string
}

export function PermissionModeToggle({ sessionID, directory }: PermissionModeToggleProps) {
  const { data, isError } = useSessionPermissionMode(sessionID)
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
          ? 'Permissions: accept everything'
          : 'Permissions: ask every time'

  const handleClick = () => {
    if (disabled) return
    setMode.mutate({ directory, mode: isAuto ? 'ask' : 'auto' })
  }

  return (
    <IconToggleButton active={isAuto} label={label} disabled={disabled} onClick={handleClick}>
      {isAuto ? <ShieldCheck className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
    </IconToggleButton>
  )
}
