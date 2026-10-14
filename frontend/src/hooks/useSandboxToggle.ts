import { useSessionSandbox, useSetSessionSandbox } from '@/hooks/useSessionSandbox'

export function useSandboxToggle(sessionID: string) {
  const { data, isError } = useSessionSandbox(sessionID)
  const setSandbox = useSetSessionSandbox(sessionID)

  const loaded = data !== undefined
  const isSandboxed = data?.sandboxed ?? false
  const available = data?.available ?? true
  const lockedReason = data?.lockedReason ?? null
  const resources = data?.resources ?? null
  const effectiveResources = data?.effectiveResources
  const disabled = !loaded || lockedReason !== null || setSandbox.isPending

  const label = !loaded
    ? isError
      ? 'Sandbox: unavailable'
      : 'Sandbox: loading'
    : lockedReason === 'child'
      ? 'Inherited from parent session'
      : isSandboxed
        ? 'Sandbox: commands run in a microVM'
        : 'Sandbox: commands run on the host'

  const toggle = () => {
    if (disabled) return
    setSandbox.mutate({ sandboxed: !isSandboxed })
  }

  return { isSandboxed, available, disabled, label, toggle, lockedReason, resources, effectiveResources }
}
