import { SessionSandboxResourcesSchema, type SessionSandboxResources } from '@opencode-manager/shared/schemas'
import type { useSandboxToggle } from '@/hooks/useSandboxToggle'

export type SandboxToggleState = ReturnType<typeof useSandboxToggle>

const cpusSchema = SessionSandboxResourcesSchema.shape.cpus
const memoryMibSchema = SessionSandboxResourcesSchema.shape.memoryMib

export const SANDBOX_CPUS_MIN = cpusSchema.minValue ?? 1
export const SANDBOX_CPUS_MAX = cpusSchema.maxValue ?? 64
export const SANDBOX_MEMORY_GIB_MIN = (memoryMibSchema.minValue ?? 1024) / 1024
export const SANDBOX_MEMORY_GIB_MAX = (memoryMibSchema.maxValue ?? 1048576) / 1024

export type SandboxResourceInputResult =
  | { kind: 'defaults' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; resources: SessionSandboxResources }

export function parseSandboxResourceInput(
  cpus: string,
  memoryGib: string,
): SandboxResourceInputResult {
  const trimmedCpus = cpus.trim()
  const trimmedMemory = memoryGib.trim()
  if (!trimmedCpus && !trimmedMemory) {
    return { kind: 'defaults' }
  }
  if (!trimmedCpus || !trimmedMemory) {
    return {
      kind: 'invalid',
      message: 'Enter both CPUs and memory, or leave both empty to use the server defaults.',
    }
  }
  const parsedCpus = Number(trimmedCpus)
  if (!Number.isInteger(parsedCpus) || !cpusSchema.safeParse(parsedCpus).success) {
    return {
      kind: 'invalid',
      message: `CPUs must be a whole number from ${SANDBOX_CPUS_MIN} to ${SANDBOX_CPUS_MAX}.`,
    }
  }
  const parsedMemory = Number(trimmedMemory)
  const memoryMib = Math.round(parsedMemory * 1024)
  if (!Number.isFinite(parsedMemory) || !memoryMibSchema.safeParse(memoryMib).success) {
    return {
      kind: 'invalid',
      message: `Memory must be between ${SANDBOX_MEMORY_GIB_MIN} and ${SANDBOX_MEMORY_GIB_MAX} GiB.`,
    }
  }
  return { kind: 'valid', resources: { cpus: parsedCpus, memoryMib } }
}

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
