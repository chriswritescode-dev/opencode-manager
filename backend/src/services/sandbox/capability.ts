import { accessSync, constants } from 'fs'
import { spawnSync } from 'child_process'
import { logger } from '../../utils/logger'
import { buildSandboxVersionArgs, resolveSandboxExecutable, resetSandboxExecutableCache, resolveSandboxExecUserUid } from './command'

export type SandboxCapability = {
  available: boolean
  reason?: string
  msbVersion?: string
}

let cachedCapability: SandboxCapability | null = null

export function detectSandboxCapability(): SandboxCapability {
  if (cachedCapability) {
    return cachedCapability
  }

  try {
    accessSync('/dev/kvm', constants.R_OK | constants.W_OK)
  } catch {
    const reason = '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host'
    cachedCapability = { available: false, reason }
    logger.info(reason)
    return cachedCapability
  }

  const execUserUid = resolveSandboxExecUserUid()
  if (
    execUserUid !== null &&
    typeof process.getuid === 'function' &&
    typeof process.getgid === 'function' &&
    execUserUid !== process.getuid()
  ) {
    const reason = `SANDBOX_EXEC_USER resolves to uid ${execUserUid}, which does not match the Manager workspace owner uid ${process.getuid()}; sandboxed commands could not write to the mounted project roots. Set SANDBOX_EXEC_USER=${process.getuid()}:${process.getgid()} or leave it unset`
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

  const result = spawnSync(executable, buildSandboxVersionArgs(), { encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0 || result.error) {
    const reason = 'msb CLI not found or not executable'
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
