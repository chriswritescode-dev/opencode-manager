import type { SessionSandboxResources } from '@opencode-manager/shared/schemas'
import type { useSandboxToggle } from '@/hooks/useSandboxToggle'

export type SandboxToggleState = ReturnType<typeof useSandboxToggle>

export function shouldShowSandboxResources(sandbox: SandboxToggleState): boolean {
  return (
    sandbox.available &&
    sandbox.isSandboxed &&
    sandbox.lockedReason !== 'child' &&
    sandbox.effectiveResources !== undefined
  )
}

export function formatSandboxMemory(memoryMib: number): string {
  const gib = memoryMib / 1024
  return Number.isInteger(gib) ? String(gib) : String(Number(gib.toFixed(1)))
}

export function formatSandboxResources(resources: SessionSandboxResources): string {
  const cpus = `${resources.cpus} CPU${resources.cpus === 1 ? '' : 's'}`
  return `${cpus} · ${formatSandboxMemory(resources.memoryMib)} GiB`
}
