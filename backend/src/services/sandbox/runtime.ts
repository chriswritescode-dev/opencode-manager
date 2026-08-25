import type { Database } from 'bun:sqlite'
import path from 'path'
import { lstat, realpath } from 'fs/promises'
import { ENV } from '@opencode-manager/shared/config/env'
import { executeCommand } from '../../utils/process'
import { mkdirSafe } from '../../utils/fs-safe'
import { logger } from '../../utils/logger'
import { SettingsService } from '../settings'
import { detectSandboxCapability } from './capability'
import {
  WORKSPACE_SANDBOX_NAME,
  buildCanonicalSandboxSpec,
  buildSandboxCreateArgs,
  buildSandboxInspectArgs,
  buildSandboxListArgs,
  buildSandboxRemoveArgs,
  buildSandboxStartArgs,
  buildSandboxStopManagedArgs,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxRuntimeTmpfsSizeMib,
  resolveSandboxWorkDirectory,
  sandboxExecutablePath,
  sandboxMountRoots,
  sandboxNetworkPolicyMismatch,
} from './command'

const SANDBOX_LS_CACHE_MS = 5000
const SANDBOX_LS_TIMEOUT_MS = 15000
const SANDBOX_STOP_TIMEOUT_MS = 30000
const SANDBOX_RUNTIME_TMPFS_GUEST = path.resolve('/tmp')

export type SandboxShellPlan =
  | { mode: 'host' }
  | { mode: 'sandbox'; workdir: string }
  | { mode: 'blocked'; reason: string }

export type SandboxStatus = {
  available: boolean
  enabled: boolean
  reason?: string
  msbVersion?: string
}

let inFlightBoot: Promise<void> | null = null
let lastKnownRunningAt: number | null = null
let shutdownRequested = false
let stopInProgress = false
let canonicalSandboxSpecMemo: Record<string, unknown> | null = null

export function resetSandboxRuntimeState(): void {
  inFlightBoot = null
  lastKnownRunningAt = null
  shutdownRequested = false
  stopInProgress = false
  canonicalSandboxSpecMemo = null
}

function memoizedCanonicalSandboxSpec(): Record<string, unknown> {
  if (canonicalSandboxSpecMemo === null) {
    canonicalSandboxSpecMemo = buildCanonicalSandboxSpec()
  }
  return canonicalSandboxSpecMemo
}

async function validateSandboxMountRoots(): Promise<void> {
  for (const root of sandboxMountRoots()) {
    const resolvedRoot = path.resolve(root)
    let stat
    try {
      stat = await lstat(root)
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode !== 'ENOENT') {
        throw new Error(`cannot inspect sandbox mount root ${root}: ${error instanceof Error ? error.message : String(error)}`)
      }
      await mkdirSafe(root)
      stat = await lstat(root)
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`sandbox mount root ${root} is a symbolic link; refusing to mount a redirected project root`)
    }
    const canonical = await realpath(root)
    if (canonical !== resolvedRoot) {
      throw new Error(`sandbox mount root ${root} resolves to ${canonical} instead of ${resolvedRoot}; refusing to mount a redirected project root`)
    }
  }
}

function ensureWorkspaceSandbox(): Promise<void> {
  if (inFlightBoot) {
    return inFlightBoot
  }
  inFlightBoot = (async () => {
    if (shutdownRequested || stopInProgress) {
      throw new Error('sandbox shutdown is in progress; refusing to boot the workspace sandbox')
    }
    if (lastKnownRunningAt !== null && Date.now() - lastKnownRunningAt < SANDBOX_LS_CACHE_MS) {
      return
    }
    await validateSandboxMountRoots()
    await bootWorkspaceSandbox()
  })().finally(() => {
    inFlightBoot = null
  })
  return inFlightBoot
}

async function bootWorkspaceSandbox(): Promise<void> {
  try {
    const outcome = await inspectSandbox()
    if (outcome.kind === 'failed' || (outcome.record.config === undefined && outcome.record.active_config === undefined)) {
      await bootWorkspaceSandboxFromListing()
    } else {
      const inspected = outcome.record
      if (inspected.active_config !== undefined && inspected.active_config !== null) {
        const attestation = await attestWorkspaceSandboxConfig(inspected.active_config)
        if (!attestation.trusted) {
          logger.warn(`Recreating unverifiable sandbox ${WORKSPACE_SANDBOX_NAME}: ${attestation.reason}`)
          await removeWorkspaceSandbox()
          await createWorkspaceSandbox()
        }
      } else {
        const attestation = await attestWorkspaceSandboxConfig(inspected.config)
        if (!attestation.trusted) {
          logger.warn(`Recreating unverifiable sandbox ${WORKSPACE_SANDBOX_NAME}: ${attestation.reason}`)
          await removeWorkspaceSandbox()
          await createWorkspaceSandbox()
        } else {
          await startWorkspaceSandbox()
          const runningAttestation = await attestWorkspaceSandbox(true)
          if (!runningAttestation.trusted) {
            logger.warn(
              `Recreating sandbox ${WORKSPACE_SANDBOX_NAME} that failed running attestation: ${runningAttestation.reason}`,
            )
            await removeWorkspaceSandbox()
            await createWorkspaceSandbox()
          }
        }
      }
    }

    lastKnownRunningAt = Date.now()
  } catch (error) {
    lastKnownRunningAt = null
    throw error
  }
}

async function bootWorkspaceSandboxFromListing(): Promise<void> {
  const entry = findWorkspaceSandboxEntry(await listSandboxes())

  if (!entry) {
    await createWorkspaceSandbox()
  } else {
    const attestation = await attestWorkspaceSandbox(entry.running)
    if (!attestation.trusted) {
      logger.warn(`Recreating unverifiable sandbox ${WORKSPACE_SANDBOX_NAME}: ${attestation.reason}`)
      await removeWorkspaceSandbox()
      await createWorkspaceSandbox()
    } else if (!entry.running) {
      await startWorkspaceSandbox()
      const runningAttestation = await attestWorkspaceSandbox(true)
      if (!runningAttestation.trusted) {
        logger.warn(
          `Recreating sandbox ${WORKSPACE_SANDBOX_NAME} that failed running attestation: ${runningAttestation.reason}`,
        )
        await removeWorkspaceSandbox()
        await createWorkspaceSandbox()
      }
    }
  }
}

type SandboxAttestation = { trusted: true } | { trusted: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveInspectSpec(config: unknown): Record<string, unknown> | null {
  if (!isRecord(config)) return null
  const wrapped = config.spec
  if (isRecord(wrapped) && (isRecord(wrapped.image) || Array.isArray(wrapped.mounts) || isRecord(wrapped.labels) || isRecord(wrapped.network))) {
    return wrapped
  }
  if (isRecord(config.image) || Array.isArray(config.mounts) || isRecord(config.labels) || isRecord(config.network)) {
    return config
  }
  return null
}

function inspectImageReference(image: unknown): string | null {
  if (!isRecord(image)) return null
  const oci = image.Oci
  if (!isRecord(oci) || typeof oci.reference !== 'string') return null
  return oci.reference
}

function sameStringArray(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function emptyArrayMismatch(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length > 0) {
    return `sandbox configuration ${path} must be empty`
  }
  return null
}

type ParsedSandboxMount =
  | { kind: 'bind'; host: string; guest: string; readonly: boolean }
  | { kind: 'tmpfs'; guest: string; readonly: boolean }
  | { kind: 'other' }

function parseInspectMount(mount: unknown): ParsedSandboxMount | null {
  if (!isRecord(mount) || typeof mount.type !== 'string') return null
  const readonly = (isRecord(mount.options) && mount.options.readonly === true) || mount.readonly === true
  if (mount.type === 'Bind') {
    if (typeof mount.host !== 'string' || typeof mount.guest !== 'string') return null
    return { kind: 'bind', host: mount.host, guest: mount.guest, readonly }
  }
  if (mount.type === 'Tmpfs') {
    if (typeof mount.guest !== 'string') return null
    return { kind: 'tmpfs', guest: mount.guest, readonly }
  }
  return { kind: 'other' }
}

async function attestWorkspaceSandboxConfig(config: unknown): Promise<SandboxAttestation> {
  const spec = resolveInspectSpec(config)
  if (spec === null) {
    return { trusted: false, reason: 'msb inspect returned an unexpected config shape' }
  }

  const canonical = memoizedCanonicalSandboxSpec()

  const labels = isRecord(spec.labels) ? spec.labels : {}
  const canonicalLabels = isRecord(canonical.labels) ? canonical.labels : {}
  if (labels['ocm.managed'] !== 'true') {
    return { trusted: false, reason: 'sandbox is not labelled ocm.managed=true' }
  }
  if (labels['ocm.net'] !== canonicalLabels['ocm.net']) {
    return {
      trusted: false,
      reason: `sandbox network profile ${String(labels['ocm.net'])} does not match ${canonicalLabels['ocm.net']}`,
    }
  }

  const imageReference = inspectImageReference(spec.image)
  const canonicalImageReference = inspectImageReference(canonical.image)
  if (imageReference === null) {
    return { trusted: false, reason: 'sandbox image is not an OCI reference' }
  }
  if (canonicalImageReference !== null && imageReference !== canonicalImageReference) {
    return { trusted: false, reason: `sandbox image ${imageReference} does not match ${canonicalImageReference}` }
  }
  const image = isRecord(spec.image) ? spec.image : {}
  const oci = isRecord(image.Oci) ? image.Oci : null
  const rootDisk = oci !== null && isRecord(oci.root_disk) ? oci.root_disk : null
  if (rootDisk !== null && rootDisk.kind === 'disk-image') {
    return { trusted: false, reason: 'sandbox image must not attach a host disk image' }
  }

  const canonicalMounts = Array.isArray(canonical.mounts) ? canonical.mounts : []
  const expectedRoots = new Set<string>()
  const expectedRealRoots = new Set<string>()
  for (const rawMount of canonicalMounts) {
    const mount = parseInspectMount(rawMount)
    if (mount?.kind === 'bind') {
      const resolvedRoot = path.resolve(mount.host)
      expectedRoots.add(resolvedRoot)
      try {
        expectedRealRoots.add(await realpath(resolvedRoot))
      } catch {
        return { trusted: false, reason: `cannot resolve the canonical bind mount root ${resolvedRoot}` }
      }
    }
  }

  const canonicalResources = isRecord(canonical.resources) ? canonical.resources : {}
  const expectedTmpfsSizeMib = resolveSandboxRuntimeTmpfsSizeMib(canonicalResources.memory_mib)
  if (expectedTmpfsSizeMib === null) {
    return { trusted: false, reason: 'sandbox memory is not a positive finite number; cannot derive the runtime tmpfs size' }
  }

  const mounts = Array.isArray(spec.mounts) ? spec.mounts : []
  const bindRoots = new Set<string>()
  let runtimeTmpfsSeen = false
  for (let mountIndex = 0; mountIndex < mounts.length; mountIndex++) {
    const rawMount = mounts[mountIndex]
    const mount = parseInspectMount(rawMount)
    if (mount === null) {
      return { trusted: false, reason: 'sandbox has an unrecognized mount entry' }
    }
    if (mount.kind === 'bind') {
      const hostPath = path.resolve(mount.host)
      if (mount.readonly) {
        return { trusted: false, reason: 'sandbox has a read-only project bind mount' }
      }
      const mountOptions = isRecord(rawMount) && isRecord(rawMount.options) ? rawMount.options : {}
      for (const flag of ['noexec', 'nosuid', 'nodev'] as const) {
        if (mountOptions[flag] === true) {
          return {
            trusted: false,
            reason: `sandbox configuration mounts[${mountIndex}].options.${flag} does not match the canonical specification`,
          }
        }
      }
      if (rawMount.stat_virtualization !== 'strict') {
        return {
          trusted: false,
          reason: `sandbox configuration mounts[${mountIndex}].stat_virtualization does not match the canonical specification`,
        }
      }
      if (rawMount.host_permissions !== 'private') {
        return {
          trusted: false,
          reason: `sandbox configuration mounts[${mountIndex}].host_permissions does not match the canonical specification`,
        }
      }
      if (rawMount.follow_root_symlinks !== false) {
        return {
          trusted: false,
          reason: `sandbox configuration mounts[${mountIndex}].follow_root_symlinks does not match the canonical specification`,
        }
      }
      if (rawMount.quota_mib !== null) {
        return {
          trusted: false,
          reason: `sandbox configuration mounts[${mountIndex}].quota_mib does not match the canonical specification`,
        }
      }
      if (hostPath !== path.resolve(mount.guest) || !expectedRoots.has(hostPath)) {
        return { trusted: false, reason: 'sandbox has an unexpected bind mount' }
      }
      let realHost: string
      try {
        realHost = await realpath(mount.host)
      } catch {
        return { trusted: false, reason: `sandbox bind mount host ${mount.host} does not exist on the host` }
      }
      if (!expectedRealRoots.has(realHost)) {
        return { trusted: false, reason: 'sandbox bind mount resolves outside the expected project roots' }
      }
      bindRoots.add(hostPath)
    } else if (mount.kind === 'tmpfs') {
      const guestPath = path.resolve(mount.guest)
      const tmpfsMountOptions = isRecord(rawMount) && isRecord(rawMount.options) ? rawMount.options : {}
      if (guestPath !== SANDBOX_RUNTIME_TMPFS_GUEST) {
        return { trusted: false, reason: `sandbox has an unexpected tmpfs mount at ${mount.guest}` }
      }
      if (runtimeTmpfsSeen) {
        return { trusted: false, reason: `sandbox has a duplicate runtime tmpfs mount at ${SANDBOX_RUNTIME_TMPFS_GUEST}` }
      }
      runtimeTmpfsSeen = true
      for (const flag of ['readonly', 'noexec', 'nosuid', 'nodev'] as const) {
        if (tmpfsMountOptions[flag] !== false) {
          return {
            trusted: false,
            reason: `sandbox configuration mounts[${mountIndex}].options.${flag} does not match the canonical specification`,
          }
        }
      }
      if (rawMount.size_mib !== expectedTmpfsSizeMib) {
        return {
          trusted: false,
          reason: `sandbox configuration mounts[${mountIndex}].size_mib does not match the canonical specification`,
        }
      }
    } else {
      return { trusted: false, reason: 'sandbox has an unexpected mount type' }
    }
  }
  if (bindRoots.size !== expectedRoots.size || [...expectedRoots].some((root) => !bindRoots.has(root))) {
    return { trusted: false, reason: 'sandbox is missing one of the project bind mounts' }
  }
  if (!runtimeTmpfsSeen) {
    return { trusted: false, reason: `sandbox is missing the runtime tmpfs mount at ${SANDBOX_RUNTIME_TMPFS_GUEST}` }
  }

  const resources = isRecord(spec.resources) ? spec.resources : {}
  if (resources.cpus !== canonicalResources.cpus) {
    return { trusted: false, reason: `sandbox cpus ${String(resources.cpus)} does not match ${String(canonicalResources.cpus)}` }
  }
  if (resources.memory_mib !== canonicalResources.memory_mib) {
    return { trusted: false, reason: `sandbox memory does not match ${String(canonicalResources.memory_mib)}` }
  }
  if (resources.max_cpus !== canonicalResources.max_cpus) {
    return { trusted: false, reason: `sandbox max cpus ${String(resources.max_cpus)} does not match ${String(canonicalResources.max_cpus)}` }
  }
  if (resources.max_memory_mib !== canonicalResources.max_memory_mib) {
    return { trusted: false, reason: `sandbox max memory does not match ${String(canonicalResources.max_memory_mib)}` }
  }

  const runtime = isRecord(spec.runtime) ? spec.runtime : {}
  const canonicalRuntime = isRecord(canonical.runtime) ? canonical.runtime : {}
  if (runtime.workdir !== canonicalRuntime.workdir) {
    return { trusted: false, reason: `sandbox workdir ${String(runtime.workdir)} does not match ${String(canonicalRuntime.workdir)}` }
  }
  if (runtime.user !== canonicalRuntime.user) {
    return { trusted: false, reason: `sandbox user ${String(runtime.user)} does not match ${String(canonicalRuntime.user)}` }
  }
  if (!sameStringArray(runtime.cmd, canonicalRuntime.cmd)) {
    return { trusted: false, reason: 'sandbox configuration runtime.cmd does not match the canonical specification' }
  }
  if (!sameStringArray(runtime.entrypoint, canonicalRuntime.entrypoint)) {
    return { trusted: false, reason: 'sandbox configuration runtime.entrypoint does not match the canonical specification' }
  }
  if (runtime.shell !== canonicalRuntime.shell) {
    return { trusted: false, reason: 'sandbox configuration runtime.shell does not match the canonical specification' }
  }
  if (!isRecord(runtime.scripts) || Object.keys(runtime.scripts).length > 0) {
    return { trusted: false, reason: 'sandbox configuration runtime.scripts must be empty' }
  }
  if (runtime.hostname !== canonicalRuntime.hostname) {
    return { trusted: false, reason: 'sandbox configuration runtime.hostname does not match the canonical specification' }
  }
  if (runtime.metrics_sample_interval_ms !== canonicalRuntime.metrics_sample_interval_ms) {
    return { trusted: false, reason: 'sandbox configuration runtime.metrics_sample_interval_ms does not match the canonical specification' }
  }
  if (runtime.disable_metrics_sample !== canonicalRuntime.disable_metrics_sample) {
    return { trusted: false, reason: 'sandbox configuration runtime.disable_metrics_sample does not match the canonical specification' }
  }

  const network = isRecord(spec.network) ? spec.network : {}
  if (network.enabled !== true) {
    return { trusted: false, reason: 'sandbox networking is disabled' }
  }
  if (!Array.isArray(network.ports) || network.ports.length > 0) {
    return { trusted: false, reason: 'sandbox configuration network.ports must be empty' }
  }
  const expectedPolicy = resolveExpectedSandboxNetworkPolicy(ENV.SANDBOX.NET)
  if (expectedPolicy === null) {
    return {
      trusted: false,
      reason: `sandbox network profile ${ENV.SANDBOX.NET} cannot be attested; supported profiles are public, private, host`,
    }
  }
  const policyMismatch = sandboxNetworkPolicyMismatch(network.policy, expectedPolicy)
  if (policyMismatch !== null) {
    return { trusted: false, reason: policyMismatch }
  }

  const secretsConfig = network.secrets
  if (secretsConfig !== undefined && secretsConfig !== null) {
    if (!isRecord(secretsConfig) || !Array.isArray(secretsConfig.secrets)) {
      return { trusted: false, reason: 'sandbox configuration network.secrets is malformed' }
    }
    if (secretsConfig.secrets.length > 0) {
      return { trusted: false, reason: 'sandbox configuration network.secrets must be empty' }
    }
  }

  const emptyMismatch = emptyArrayMismatch(spec.patches, 'patches')
  if (emptyMismatch !== null) return { trusted: false, reason: emptyMismatch }
  const rlimitsMismatch = emptyArrayMismatch(spec.rlimits, 'rlimits')
  if (rlimitsMismatch !== null) return { trusted: false, reason: rlimitsMismatch }

  if (spec.init !== null) {
    return { trusted: false, reason: 'sandbox configuration init must be empty' }
  }
  if (spec.pull_policy !== 'IfMissing') {
    return { trusted: false, reason: `sandbox pull policy ${String(spec.pull_policy)} must be IfMissing` }
  }
  if (spec.security_profile !== 'default') {
    return { trusted: false, reason: 'sandbox configuration security_profile must be default' }
  }
  const lifecycle = isRecord(spec.lifecycle) ? spec.lifecycle : {}
  if (lifecycle.ephemeral !== false) {
    return { trusted: false, reason: 'sandbox configuration lifecycle.ephemeral must be false' }
  }
  if (lifecycle.max_duration_secs !== null) {
    return { trusted: false, reason: 'sandbox configuration lifecycle.max_duration_secs must be empty' }
  }
  if (lifecycle.idle_timeout_secs !== null) {
    return { trusted: false, reason: 'sandbox configuration lifecycle.idle_timeout_secs must be empty' }
  }
  if (spec.manifest_digest !== undefined && spec.manifest_digest !== null) {
    if (typeof spec.manifest_digest !== 'string' || spec.manifest_digest === '') {
      return { trusted: false, reason: 'sandbox manifest digest is malformed' }
    }
  }

  return { trusted: true }
}

type SandboxInspectOutcome =
  | { kind: 'parsed'; record: Record<string, unknown> }
  | { kind: 'failed'; reason: string }

async function inspectSandbox(): Promise<SandboxInspectOutcome> {
  let result: string | { exitCode: number; stdout: string; stderr: string }
  try {
    result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxInspectArgs()], {
      ignoreExitCode: true,
      silent: true,
      timeout: SANDBOX_LS_TIMEOUT_MS,
    })) as string | { exitCode: number; stdout: string; stderr: string }
  } catch (error) {
    return { kind: 'failed', reason: `msb inspect failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  const listing = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result

  if (listing.exitCode !== 0) {
    return {
      kind: 'failed',
      reason: `msb inspect failed with code ${listing.exitCode}: ${listing.stderr || listing.stdout}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(listing.stdout)
  } catch {
    return { kind: 'failed', reason: 'msb inspect returned malformed JSON' }
  }
  if (!isRecord(parsed)) {
    return { kind: 'failed', reason: 'msb inspect returned an unexpected JSON shape' }
  }
  return { kind: 'parsed', record: parsed }
}

async function attestWorkspaceSandbox(running: boolean): Promise<SandboxAttestation> {
  const outcome = await inspectSandbox()
  if (outcome.kind === 'failed') {
    return { trusted: false, reason: outcome.reason }
  }
  if (running) {
    if (outcome.record.active_config === undefined || outcome.record.active_config === null) {
      return { trusted: false, reason: 'msb inspect returned no active configuration for the running sandbox' }
    }
    return await attestWorkspaceSandboxConfig(outcome.record.active_config)
  }
  return await attestWorkspaceSandboxConfig(outcome.record.config)
}

async function createWorkspaceSandbox(): Promise<void> {
  await executeCommand([sandboxExecutablePath(), ...buildSandboxCreateArgs()], {
    timeout: ENV.SANDBOX.START_TIMEOUT_MS,
  })
  const attestation = await attestWorkspaceSandbox(true)
  if (!attestation.trusted) {
    throw new Error(`newly created sandbox ${WORKSPACE_SANDBOX_NAME} failed attestation: ${attestation.reason}`)
  }
}

async function removeWorkspaceSandbox(): Promise<void> {
  const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxRemoveArgs()], {
    ignoreExitCode: true,
    timeout: SANDBOX_LS_TIMEOUT_MS,
  })) as string | { exitCode: number; stdout: string; stderr: string }
  const removal = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
  if (removal.exitCode !== 0) {
    throw new Error(`msb rm failed with code ${removal.exitCode}: ${removal.stderr || removal.stdout}`)
  }
}

type SandboxLsEntry = {
  name?: unknown
  status?: unknown
  state?: unknown
}

async function listSandboxes(): Promise<SandboxLsEntry[]> {
  const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxListArgs()], {
    ignoreExitCode: true,
    silent: true,
    timeout: SANDBOX_LS_TIMEOUT_MS,
  })) as string | { exitCode: number; stdout: string; stderr: string }
  const listing = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result

  if (listing.exitCode !== 0) {
    throw new Error(`msb ls failed with code ${listing.exitCode}: ${listing.stderr || listing.stdout}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(listing.stdout)
  } catch {
    throw new Error(`msb ls returned malformed JSON (${listing.stdout.slice(0, 200)})`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('msb ls returned an unexpected JSON shape (expected a top-level array)')
  }
  return parsed as SandboxLsEntry[]
}

function findWorkspaceSandboxEntry(entries: SandboxLsEntry[]): { running: boolean } | null {
  for (const value of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as SandboxLsEntry
    if (entry.name !== WORKSPACE_SANDBOX_NAME) continue
    const status = entry.status ?? entry.state
    return { running: String(status).toLowerCase() === 'running' }
  }

  return null
}

async function startWorkspaceSandbox(): Promise<void> {
  const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxStartArgs()], {
    ignoreExitCode: true,
    timeout: ENV.SANDBOX.START_TIMEOUT_MS,
  })) as string | { exitCode: number; stdout: string; stderr: string }
  if (typeof result === 'string' || result.exitCode === 0) {
    return
  }

  const entry = findWorkspaceSandboxEntry(await listSandboxes())
  if (entry?.running) {
    return
  }
  throw new Error(`msb start failed with code ${result.exitCode}: ${result.stderr || result.stdout}`)
}

export class SandboxRuntimeService {
  constructor(private readonly db: Database) {}

  isEnabled(): boolean {
    return this.isSandboxEnabled()
  }

  getStatus(): SandboxStatus {
    const capability = detectSandboxCapability()
    return {
      available: capability.available,
      enabled: this.isEnabled(),
      ...(capability.reason !== undefined ? { reason: capability.reason } : {}),
      ...(capability.msbVersion !== undefined ? { msbVersion: capability.msbVersion } : {}),
    }
  }

  async planShell(directory: string, enforced = false): Promise<SandboxShellPlan> {
    if (!enforced && !this.isEnabled()) {
      return { mode: 'host' }
    }
    const capability = detectSandboxCapability()
    if (!capability.available) {
      return { mode: 'blocked', reason: capability.reason ?? 'Sandbox capability is unavailable' }
    }
    const workDirectory = await resolveSandboxWorkDirectory(directory)
    if (workDirectory === null) {
      return {
        mode: 'blocked',
        reason: `working directory is outside the sandboxed project roots (${sandboxMountRoots().join(', ')})`,
      }
    }
    try {
      await ensureWorkspaceSandbox()
      return { mode: 'sandbox', workdir: workDirectory }
    } catch (error) {
      logger.error('Failed to prepare the workspace sandbox', error)
      return { mode: 'blocked', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  async stopWorkspaceSandbox(): Promise<void> {
    shutdownRequested = true
    await this.stopManagedSandbox()
  }

  async stopWorkspaceSandboxForToggle(): Promise<void> {
    await this.stopManagedSandbox()
  }

  private async stopManagedSandbox(): Promise<void> {
    stopInProgress = true
    try {
      await this.runManagedSandboxStop()
    } finally {
      stopInProgress = false
    }
  }

  private async runManagedSandboxStop(): Promise<void> {
    while (inFlightBoot) {
      try {
        await inFlightBoot
      } catch {
        // a settled boot is done; keep waiting for any other admitted boot
      }
    }
    lastKnownRunningAt = null
    const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxStopManagedArgs()], {
      ignoreExitCode: true,
      timeout: SANDBOX_STOP_TIMEOUT_MS,
    })) as string | { exitCode: number; stdout: string; stderr: string }
    const stopResult = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
    if (stopResult.exitCode !== 0) {
      try {
        await confirmManagedSandboxStopped()
        logger.warn(`msb stop failed with code ${stopResult.exitCode} but the workspace sandbox is confirmed stopped: ${stopResult.stderr || stopResult.stdout}`)
      } catch (error) {
        logger.error('Failed to confirm the workspace sandbox stopped:', error)
        throw error
      }
    }
  }

  private isSandboxEnabled(): boolean {
    return new SettingsService(this.db).getSettings('default').preferences.sandbox?.enabled === true
  }
}

async function confirmManagedSandboxStopped(): Promise<void> {
  const entry = findWorkspaceSandboxEntry(await listSandboxes())
  if (entry !== null && entry.running) {
    throw new Error('msb stop failed to stop the workspace sandbox; the managed microVM is still running')
  }
}

export async function stopWorkspaceSandboxOnShutdown(db: Database): Promise<void> {
  await new SandboxRuntimeService(db).stopWorkspaceSandbox()
}
