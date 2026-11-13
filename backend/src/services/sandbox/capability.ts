import { accessSync, constants } from 'fs'
import { spawnSync } from 'child_process'
import { logger } from '../../utils/logger'
import { buildSandboxVersionArgs, resolveSandboxExecutable, resetSandboxExecutableCache, resolveSandboxExecUserUid } from './command'

export type SandboxCapability = {
  available: boolean
  reason?: string
  msbVersion?: string
}

export interface MsbVersionProbeResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

export interface SandboxCapabilityProbes {
  isKvmAccessible: () => boolean
  readMsbVersion: (executable: string) => MsbVersionProbeResult
  resolveExecUserUid: () => number | null
  currentUid: () => number | undefined
  currentGid: () => number | undefined
}

export const sandboxCapabilityProbes: SandboxCapabilityProbes = {
  isKvmAccessible: () => {
    try {
      accessSync('/dev/kvm', constants.R_OK | constants.W_OK)
      return true
    } catch {
      return false
    }
  },
  readMsbVersion: (executable) => spawnSync(executable, buildSandboxVersionArgs(), { encoding: 'utf8', timeout: 10000 }),
  resolveExecUserUid: resolveSandboxExecUserUid,
  currentUid: () => process.getuid?.(),
  currentGid: () => process.getgid?.(),
}

let cachedCapability: SandboxCapability | null = null

export function detectSandboxCapability(probes: SandboxCapabilityProbes = sandboxCapabilityProbes): SandboxCapability {
  if (cachedCapability) {
    return cachedCapability
  }

  if (!probes.isKvmAccessible()) {
    const reason = '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host'
    cachedCapability = { available: false, reason }
    logger.info(reason)
    return cachedCapability
  }

  const execUserUid = probes.resolveExecUserUid()
  const currentUid = probes.currentUid()
  const currentGid = probes.currentGid()
  if (execUserUid !== null && currentUid !== undefined && currentGid !== undefined && execUserUid !== currentUid) {
    const reason = `SANDBOX_EXEC_USER resolves to uid ${execUserUid}, which does not match the Manager workspace owner uid ${currentUid}; sandboxed commands could not write to the mounted project roots. Set SANDBOX_EXEC_USER=${currentUid}:${currentGid} or leave it unset`
    cachedCapability = { available: false, reason }
    logger.info(reason)
    return cachedCapability
  }

  const executable = resolveSandboxExecutable()
  if (executable === null) {
    const reason = 'msb CLI not found or not executable'
    cachedCapability = { available: false, reason }
    logger.info(reason)
    return cachedCapability
  }

  const result = probes.readMsbVersion(executable)
  if (result.status !== 0 || result.error) {
    const detail = result.error
      ? result.error.message
      : (result.stderr ?? '').trim() || `exit code ${String(result.status)}`
    const reason = `msb CLI version probe failed at ${executable}: ${detail}`
    cachedCapability = { available: false, reason }
    logger.info(reason)
    return cachedCapability
  }

  cachedCapability = {
    available: true,
    msbVersion: result.stdout.trim(),
  }
  return cachedCapability
}

export function resetSandboxCapabilityCache(): void {
  cachedCapability = null
  resetSandboxExecutableCache()
}
