import type { Database } from 'bun:sqlite'
import path from 'path'
import { lstat, realpath } from 'fs/promises'
import {
  ENV,
  getOpenCodeAgentTmpPath,
  getOpenCodeGlobalSkillsPath,
  getOpenCodeToolOutputPath,
} from '@opencode-manager/shared/config/env'
import { DEFAULT_SANDBOX_IDLE_STOP_MINUTES, DEFAULT_SANDBOX_MAX_RUNNING_VMS } from '@opencode-manager/shared/schemas'
import { executeCommand } from '../../utils/process'
import { isPathWithinRoot, mkdirSafe } from '../../utils/fs-safe'
import { logger } from '../../utils/logger'
import { SettingsService } from '../settings'
import { CredentialProvider } from '../credential-provider'
import type { RepoEnvService } from '../repo-env'
import { getGitIdentityEnvForDirectory } from '../git-identity'
import { getProcessIdentityAttestationError } from '../opencode/process-identity'
import { detectSandboxCapability } from './capability'
import {
  SESSION_SANDBOX_NAME_PATTERN,
  buildCanonicalSandboxSpec,
  buildSandboxCreateArgs,
  buildSandboxInspectArgs,
  buildSandboxListArgs,
  buildSandboxPingArgs,
  buildSandboxProvisionArgs,
  buildSandboxPullArgs,
  buildSandboxRemoveArgs,
  buildSandboxStartArgs,
  buildSandboxStopArgs,
  buildSandboxStopManagedArgs,
  buildSandboxVerifyProvisionArgs,
  buildSandboxVolumeRemoveArgs,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxRuntimeTmpfsSizeMib,
  resolveSandboxWorkDirectory,
  resolveSessionSandboxMounts,
  sandboxDockerDataVolumeName,
  sandboxExecutablePath,
  sandboxNetworkPolicyMismatch,
  sandboxProjectRoots,
  sandboxVmMountRoots,
  sessionSandboxName,
  type SandboxVmSpec,
} from './command'

const SANDBOX_LS_CACHE_MS = 5000
const SANDBOX_LS_TIMEOUT_MS = 15000
const SANDBOX_STOP_TIMEOUT_MS = 30000
const SANDBOX_PROVISION_ATTEMPTS = 3
const SANDBOX_PROVISION_RETRY_DELAY_MS = 2000
const SANDBOX_PROVISION_RETRY_ATTEMPTS = 5
const SANDBOX_AGENT_PING_TIMEOUT_MS = 10000
const SANDBOX_AGENT_POLL_DELAY_MS = 1000
const SANDBOX_IDLE_SWEEP_INTERVAL_MS = 60000
const SANDBOX_RUNTIME_TMPFS_GUEST = path.resolve('/tmp')
const SANDBOX_REMOVAL_MISSING_PATTERN = /not found|no such sandbox|unknown sandbox|does not exist/i
const SANDBOX_VOLUME_REMOVAL_MISSING_PATTERN = /not found|no such volume|unknown volume|does not exist/i
const SANDBOX_CREATE_EXISTS_PATTERN = /already exists/i

export type SandboxShellTarget = {
  rootSessionId: string
  locationDirectory: string
  resources: { cpus: number; memoryMib: number }
}

export type SandboxShellPlan =
  | { mode: 'host' }
  | { mode: 'sandbox'; name: string; workdir: string; env?: Record<string, string> }
  | { mode: 'blocked'; reason: string }

export type SandboxStatus = {
  available: boolean
  enabled: boolean
  reason?: string
  msbVersion?: string
}

type VmState = {
  inFlightBoot: Promise<void> | null
  inFlightRemoval: Promise<void> | null
  lastKnownRunningAt: number | null
  lastUsedAt: number
  inFlightProvision: Promise<void> | null
  backgroundProvisionRetry: Promise<void> | null
  provisionRetryGeneration: number
}

const vmStates = new Map<string, VmState>()

let shutdownRequested = false
let stopInProgress = false
let idleSweepTimer: ReturnType<typeof setInterval> | null = null
let idleSweepStartedAt = 0
let startAdmission: Promise<void> = Promise.resolve()

function vmState(name: string): VmState {
  const existing = vmStates.get(name)
  if (existing !== undefined) return existing
  const created: VmState = {
    inFlightBoot: null,
    inFlightRemoval: null,
    lastKnownRunningAt: null,
    lastUsedAt: 0,
    inFlightProvision: null,
    backgroundProvisionRetry: null,
    provisionRetryGeneration: 0,
  }
  vmStates.set(name, created)
  return created
}

export function resetSandboxRuntimeState(): void {
  for (const state of vmStates.values()) {
    state.provisionRetryGeneration += 1
    state.backgroundProvisionRetry = null
    state.inFlightProvision = null
    state.inFlightBoot = null
    state.inFlightRemoval = null
  }
  vmStates.clear()
  shutdownRequested = false
  stopInProgress = false
  idleSweepStartedAt = 0
  if (idleSweepTimer !== null) {
    clearInterval(idleSweepTimer)
    idleSweepTimer = null
  }
  startAdmission = Promise.resolve()
}

async function validateSandboxVmMountRoots(spec: SandboxVmSpec): Promise<void> {
  const creatableRoots = new Set([getOpenCodeToolOutputPath(), getOpenCodeGlobalSkillsPath(), getOpenCodeAgentTmpPath()])
  for (const root of sandboxVmMountRoots(spec)) {
    const resolvedRoot = path.resolve(root)
    let stat
    try {
      stat = await lstat(root)
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode !== 'ENOENT') {
        throw new Error(`cannot inspect sandbox mount root ${root}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!creatableRoots.has(root)) {
        throw new Error(`sandbox mount root ${root} does not exist`)
      }
      await mkdirSafe(root)
      stat = await lstat(root)
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`sandbox mount root ${root} is a symbolic link; refusing to mount a redirected root`)
    }
    const canonical = await realpath(root)
    if (canonical !== resolvedRoot) {
      throw new Error(`sandbox mount root ${root} resolves to ${canonical} instead of ${resolvedRoot}; refusing to mount a redirected root`)
    }
  }
}

function ensureSessionSandbox(spec: SandboxVmSpec, maxRunningVms: number): Promise<void> {
  const state = vmState(spec.name)
  if (state.inFlightBoot) {
    return state.inFlightBoot
  }
  state.inFlightBoot = (async () => {
    if (shutdownRequested || stopInProgress) {
      throw new Error('sandbox shutdown is in progress; refusing to boot the session sandbox')
    }
    const inFlightRemoval = state.inFlightRemoval
    if (inFlightRemoval !== null) {
      await inFlightRemoval.catch(() => undefined)
    }
    if (state.lastKnownRunningAt !== null && Date.now() - state.lastKnownRunningAt < SANDBOX_LS_CACHE_MS) {
      return
    }
    await validateSandboxVmMountRoots(spec)
    await bootSessionSandbox(spec, maxRunningVms)
  })().finally(() => {
    state.inFlightBoot = null
  })
  return state.inFlightBoot
}

async function bootSessionSandbox(spec: SandboxVmSpec, maxRunningVms: number): Promise<void> {
  const state = vmState(spec.name)
  try {
    const outcome = await inspectSandbox(spec.name)
    if (outcome.kind === 'failed' || (outcome.record.config === undefined && outcome.record.active_config === undefined)) {
      await bootSessionSandboxFromListing(spec, maxRunningVms)
    } else {
      const inspected = outcome.record
      if (inspected.active_config !== undefined && inspected.active_config !== null) {
        const attestation = await attestSandboxConfig(spec, inspected.active_config)
        if (!attestation.trusted) {
          logger.warn(`Recreating unverifiable sandbox ${spec.name}: ${attestation.reason}`)
          await removeSessionSandboxVm(spec.name)
          await createSessionSandbox(spec, maxRunningVms)
        }
      } else {
        const attestation = await attestSandboxConfig(spec, inspected.config)
        if (!attestation.trusted) {
          logger.warn(`Recreating unverifiable sandbox ${spec.name}: ${attestation.reason}`)
          await removeSessionSandboxVm(spec.name)
          await createSessionSandbox(spec, maxRunningVms)
        } else {
          await withStartAdmission(spec.name, maxRunningVms, () => startSessionSandbox(spec.name))
          await provisionSandboxExecUser(spec.name)
          const runningAttestation = await attestSessionSandbox(spec, true)
          if (!runningAttestation.trusted) {
            logger.warn(
              `Recreating sandbox ${spec.name} that failed running attestation: ${runningAttestation.reason}`,
            )
            await removeSessionSandboxVm(spec.name)
            await createSessionSandbox(spec, maxRunningVms)
          }
        }
      }
    }

    state.lastKnownRunningAt = Date.now()
  } catch (error) {
    state.lastKnownRunningAt = null
    throw error
  }
}

async function bootSessionSandboxFromListing(spec: SandboxVmSpec, maxRunningVms: number): Promise<void> {
  const entry = findSessionSandboxEntry(await listSandboxes(), spec.name)

  if (!entry) {
    await createSessionSandbox(spec, maxRunningVms)
  } else {
    const attestation = await attestSessionSandbox(spec, entry.running)
    if (!attestation.trusted) {
      logger.warn(`Recreating unverifiable sandbox ${spec.name}: ${attestation.reason}`)
      await removeSessionSandboxVm(spec.name)
      await createSessionSandbox(spec, maxRunningVms)
    } else if (!entry.running) {
      await withStartAdmission(spec.name, maxRunningVms, () => startSessionSandbox(spec.name))
      await provisionSandboxExecUser(spec.name)
      const runningAttestation = await attestSessionSandbox(spec, true)
      if (!runningAttestation.trusted) {
        logger.warn(
          `Recreating sandbox ${spec.name} that failed running attestation: ${runningAttestation.reason}`,
        )
        await removeSessionSandboxVm(spec.name)
        await createSessionSandbox(spec, maxRunningVms)
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
  | { kind: 'named'; name: string; guest: string; readonly: boolean }
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
  if (mount.type === 'Named') {
    if (typeof mount.name !== 'string' || typeof mount.guest !== 'string') return null
    return { kind: 'named', name: mount.name, guest: mount.guest, readonly }
  }
  return { kind: 'other' }
}

async function attestSandboxConfig(spec: SandboxVmSpec, config: unknown): Promise<SandboxAttestation> {
  const inspectedSpec = resolveInspectSpec(config)
  if (inspectedSpec === null) {
    return { trusted: false, reason: 'msb inspect returned an unexpected config shape' }
  }

  const canonical = buildCanonicalSandboxSpec(spec)

  const labels = isRecord(inspectedSpec.labels) ? inspectedSpec.labels : {}
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
  if (labels['ocm.session'] !== canonicalLabels['ocm.session']) {
    return {
      trusted: false,
      reason: `sandbox session label ${String(labels['ocm.session'])} does not match ${String(canonicalLabels['ocm.session'])}`,
    }
  }

  const imageReference = inspectImageReference(inspectedSpec.image)
  const canonicalImageReference = inspectImageReference(canonical.image)
  if (imageReference === null) {
    return { trusted: false, reason: 'sandbox image is not an OCI reference' }
  }
  if (canonicalImageReference !== null && imageReference !== canonicalImageReference) {
    return { trusted: false, reason: `sandbox image ${imageReference} does not match ${canonicalImageReference}` }
  }
  const image = isRecord(inspectedSpec.image) ? inspectedSpec.image : {}
  const oci = isRecord(image.Oci) ? image.Oci : null
  const rootDisk = oci !== null && isRecord(oci.root_disk) ? oci.root_disk : null
  if (rootDisk !== null && rootDisk.kind === 'disk-image') {
    return { trusted: false, reason: 'sandbox image must not attach a host disk image' }
  }

  const canonicalMounts = Array.isArray(canonical.mounts) ? canonical.mounts : []
  const expectedRoots = new Set<string>()
  const expectedRealRoots = new Set<string>()
  const expectedNamedMounts: Array<{ name: string; guest: string }> = []
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
    } else if (mount?.kind === 'named') {
      expectedNamedMounts.push({ name: mount.name, guest: mount.guest })
    }
  }

  const canonicalResources = isRecord(canonical.resources) ? canonical.resources : {}
  const expectedTmpfsSizeMib = resolveSandboxRuntimeTmpfsSizeMib(canonicalResources.memory_mib)
  if (expectedTmpfsSizeMib === null) {
    return { trusted: false, reason: 'sandbox memory is not a positive finite number; cannot derive the runtime tmpfs size' }
  }

  const mounts = Array.isArray(inspectedSpec.mounts) ? inspectedSpec.mounts : []
  const bindRoots = new Set<string>()
  let runtimeTmpfsSeen = false
  let dockerDataVolumeSeen = false
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
    } else if (mount.kind === 'named') {
      if (dockerDataVolumeSeen) {
        return { trusted: false, reason: `sandbox has a duplicate Docker data volume mount at ${mount.guest}` }
      }
      dockerDataVolumeSeen = true
      const expectedNamedMount = expectedNamedMounts[0]
      if (
        mount.readonly ||
        expectedNamedMount === undefined ||
        expectedNamedMount.name !== mount.name ||
        expectedNamedMount.guest !== mount.guest
      ) {
        return { trusted: false, reason: 'sandbox has an unexpected named volume mount' }
      }
      const namedMountOptions = isRecord(rawMount) && isRecord(rawMount.options) ? rawMount.options : {}
      for (const flag of ['readonly', 'noexec', 'nosuid', 'nodev'] as const) {
        if (namedMountOptions[flag] !== false) {
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
  if (!dockerDataVolumeSeen) {
    return { trusted: false, reason: 'sandbox is missing the Docker data volume mount' }
  }

  const resources = isRecord(inspectedSpec.resources) ? inspectedSpec.resources : {}
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

  const runtime = isRecord(inspectedSpec.runtime) ? inspectedSpec.runtime : {}
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

  const network = isRecord(inspectedSpec.network) ? inspectedSpec.network : {}
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

  const emptyMismatch = emptyArrayMismatch(inspectedSpec.patches, 'patches')
  if (emptyMismatch !== null) return { trusted: false, reason: emptyMismatch }
  const rlimitsMismatch = emptyArrayMismatch(inspectedSpec.rlimits, 'rlimits')
  if (rlimitsMismatch !== null) return { trusted: false, reason: rlimitsMismatch }

  if (inspectedSpec.init !== null) {
    return { trusted: false, reason: 'sandbox configuration init must be empty' }
  }
  if (inspectedSpec.pull_policy !== 'IfMissing') {
    return { trusted: false, reason: `sandbox pull policy ${String(inspectedSpec.pull_policy)} must be IfMissing` }
  }
  if (inspectedSpec.security_profile !== 'default') {
    return { trusted: false, reason: 'sandbox configuration security_profile must be default' }
  }
  const lifecycle = isRecord(inspectedSpec.lifecycle) ? inspectedSpec.lifecycle : {}
  if (lifecycle.ephemeral !== false) {
    return { trusted: false, reason: 'sandbox configuration lifecycle.ephemeral must be false' }
  }
  if (lifecycle.max_duration_secs !== null) {
    return { trusted: false, reason: 'sandbox configuration lifecycle.max_duration_secs must be empty' }
  }
  if (lifecycle.idle_timeout_secs !== null) {
    return { trusted: false, reason: 'sandbox configuration lifecycle.idle_timeout_secs must be empty' }
  }
  if (inspectedSpec.manifest_digest !== undefined && inspectedSpec.manifest_digest !== null) {
    if (typeof inspectedSpec.manifest_digest !== 'string' || inspectedSpec.manifest_digest === '') {
      return { trusted: false, reason: 'sandbox manifest digest is malformed' }
    }
  }

  return { trusted: true }
}

type SandboxInspectOutcome =
  | { kind: 'parsed'; record: Record<string, unknown> }
  | { kind: 'failed'; reason: string }

async function inspectSandbox(name: string): Promise<SandboxInspectOutcome> {
  let result: string | { exitCode: number; stdout: string; stderr: string }
  try {
    result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxInspectArgs(name)], {
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

async function attestSessionSandbox(spec: SandboxVmSpec, running: boolean): Promise<SandboxAttestation> {
  const outcome = await inspectSandbox(spec.name)
  if (outcome.kind === 'failed') {
    return { trusted: false, reason: outcome.reason }
  }
  if (running) {
    if (outcome.record.active_config === undefined || outcome.record.active_config === null) {
      return { trusted: false, reason: 'msb inspect returned no active configuration for the running sandbox' }
    }
    return await attestSandboxConfig(spec, outcome.record.active_config)
  }
  return await attestSandboxConfig(spec, outcome.record.config)
}

async function cacheSandboxImage(): Promise<void> {
  logger.info(`Caching the sandbox guest image ${ENV.SANDBOX.IMAGE}`)
  await executeCommand([sandboxExecutablePath(), ...buildSandboxPullArgs()], {
    timeout: ENV.SANDBOX.START_TIMEOUT_MS,
  })
  logger.info(`Sandbox guest image ${ENV.SANDBOX.IMAGE} is cached`)
}

async function pingSandboxAgent(name: string): Promise<boolean> {
  try {
    const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxPingArgs(name)], {
      ignoreExitCode: true,
      silent: true,
      timeout: SANDBOX_AGENT_PING_TIMEOUT_MS,
    })) as string | { exitCode: number; stdout: string; stderr: string }
    return typeof result === 'string' || result.exitCode === 0
  } catch {
    return false
  }
}

async function waitForSandboxAgent(name: string): Promise<boolean> {
  const deadline = Date.now() + ENV.SANDBOX.START_TIMEOUT_MS
  for (;;) {
    if (await pingSandboxAgent(name)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, SANDBOX_AGENT_POLL_DELAY_MS))
  }
}

async function provisionSandboxExecUser(name: string): Promise<void> {
  try {
    await ensureSandboxExecUserProvisioned(name)
    return
  } catch (error) {
    logger.warn(
      `Sandbox exec user provisioning failed for ${name}, so sudo will not work inside the guest yet; retrying in the background: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  scheduleBackgroundProvisionRetry(name)
}

async function provisionSandboxExecUserPasswd(name: string): Promise<void> {
  const provisionArgs = buildSandboxProvisionArgs(name)
  if (provisionArgs.length === 0) {
    return
  }
  if (!(await waitForSandboxAgent(name))) {
    throw new Error('the sandbox agent did not become reachable before the exec user could be provisioned')
  }
  let lastError: unknown = null
  const deadline = Date.now() + ENV.SANDBOX.START_TIMEOUT_MS
  for (let attempt = 0; attempt < SANDBOX_PROVISION_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, SANDBOX_PROVISION_RETRY_DELAY_MS))
    }
    try {
      await executeCommand([sandboxExecutablePath(), ...provisionArgs], {
        timeout: ENV.SANDBOX.START_TIMEOUT_MS,
      })
      const verifyArgs = buildSandboxVerifyProvisionArgs(name)
      if (verifyArgs.length > 0) {
        await executeCommand([sandboxExecutablePath(), ...verifyArgs], {
          timeout: SANDBOX_LS_TIMEOUT_MS,
        })
      }
      return
    } catch (error) {
      lastError = error
      if (Date.now() >= deadline) break
    }
  }
  throw new Error(
    `provisioning the sandbox exec user passwd entry failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

function ensureSandboxExecUserProvisioned(name: string): Promise<void> {
  const state = vmState(name)
  if (state.inFlightProvision) {
    return state.inFlightProvision
  }
  state.inFlightProvision = provisionSandboxExecUserPasswd(name).finally(() => {
    state.inFlightProvision = null
  })
  return state.inFlightProvision
}

export function backgroundProvisionRetryForTests(name: string): Promise<void> | null {
  return vmStates.get(name)?.backgroundProvisionRetry ?? null
}

export function provisionSandboxExecUserForTests(name: string): Promise<void> {
  return ensureSandboxExecUserProvisioned(name)
}

function scheduleBackgroundProvisionRetry(name: string): void {
  const state = vmState(name)
  const generation = state.provisionRetryGeneration
  if (state.backgroundProvisionRetry !== null) return
  logger.info(`Sandbox exec user provisioning background retry scheduled for ${name}`)
  state.backgroundProvisionRetry = (async () => {
    for (let attempt = 1; attempt <= SANDBOX_PROVISION_RETRY_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, SANDBOX_PROVISION_RETRY_DELAY_MS))
      if (generation !== state.provisionRetryGeneration) {
        logger.info('Sandbox exec user provisioning background retry cancelled by a runtime state reset')
        return
      }
      if (shutdownRequested) {
        logger.info('Sandbox exec user provisioning background retry cancelled by shutdown')
        return
      }
      try {
        await ensureSandboxExecUserProvisioned(name)
        logger.info(`Sandbox exec user provisioned by the background retry (attempt ${attempt})`)
        return
      } catch (error) {
        logger.warn(
          `Sandbox exec user provisioning background retry attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        if (generation !== state.provisionRetryGeneration || shutdownRequested) return
      }
    }
    logger.warn(
      'Sandbox exec user provisioning retries were exhausted; sudo will not work inside the guest until the next boot cycle',
    )
  })().finally(() => {
    if (generation === state.provisionRetryGeneration) {
      state.backgroundProvisionRetry = null
    }
  })
}

async function createSessionSandbox(spec: SandboxVmSpec, maxRunningVms: number): Promise<void> {
  await withStartAdmission(spec.name, maxRunningVms, () => runSandboxCreate(spec))
  await provisionSandboxExecUser(spec.name)
  const attestation = await attestSessionSandbox(spec, true)
  if (!attestation.trusted) {
    throw new Error(`newly created sandbox ${spec.name} failed attestation: ${attestation.reason}`)
  }
}

async function runSandboxCreate(spec: SandboxVmSpec): Promise<void> {
  const first = await executeSandboxCreate(buildSandboxCreateArgs(spec))
  if (first.exitCode === 0) return
  if (!SANDBOX_CREATE_EXISTS_PATTERN.test(`${first.stdout}\n${first.stderr}`)) {
    throw new Error(`Command failed with code ${first.exitCode}: ${first.stderr || first.stdout}`)
  }
  logger.warn(
    `Sandbox ${spec.name} already exists as an orphaned msb sandbox; recreating it with --replace: ${first.stderr || first.stdout}`,
  )
  const replaced = await executeSandboxCreate(buildSandboxCreateArgs(spec, { replace: true }))
  if (replaced.exitCode !== 0) {
    throw new Error(`Command failed with code ${replaced.exitCode}: ${replaced.stderr || replaced.stdout}`)
  }
}

async function executeSandboxCreate(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = (await executeCommand([sandboxExecutablePath(), ...args], {
    ignoreExitCode: true,
    timeout: ENV.SANDBOX.START_TIMEOUT_MS,
  })) as string | { exitCode: number; stdout: string; stderr: string }
  return typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
}

async function removeSessionSandboxVm(name: string): Promise<void> {
  await runSandboxRemoval(buildSandboxRemoveArgs(name), SANDBOX_REMOVAL_MISSING_PATTERN, 'msb rm')
}

function removeSandboxVmAndVolume(name: string): Promise<void> {
  const state = vmState(name)
  if (state.inFlightRemoval !== null) {
    return state.inFlightRemoval
  }
  const inFlightBoot = state.inFlightBoot
  state.inFlightRemoval = (async () => {
    if (inFlightBoot !== null) {
      await inFlightBoot.catch(() => undefined)
    }
    await removeSessionSandboxVm(name)
    await runSandboxRemoval(
      buildSandboxVolumeRemoveArgs(sandboxDockerDataVolumeName(name)),
      SANDBOX_VOLUME_REMOVAL_MISSING_PATTERN,
      'msb volume rm',
    )
    state.lastKnownRunningAt = null
  })().finally(() => {
    state.inFlightRemoval = null
  })
  return state.inFlightRemoval
}

async function runSandboxRemoval(args: string[], missingPattern: RegExp, label: string): Promise<void> {
  const result = (await executeCommand([sandboxExecutablePath(), ...args], {
    ignoreExitCode: true,
    timeout: SANDBOX_LS_TIMEOUT_MS,
  })) as string | { exitCode: number; stdout: string; stderr: string }
  const removal = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
  if (removal.exitCode === 0) return
  if (missingPattern.test(removal.stderr)) return
  throw new Error(`${label} failed with code ${removal.exitCode}: ${removal.stderr || removal.stdout}`)
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

function sandboxEntryRunning(entry: SandboxLsEntry): boolean {
  const status = entry.status ?? entry.state
  return String(status).toLowerCase() === 'running'
}

function findSessionSandboxEntry(entries: SandboxLsEntry[], name: string): { running: boolean } | null {
  for (const value of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as SandboxLsEntry
    if (entry.name !== name) continue
    return { running: sandboxEntryRunning(entry) }
  }

  return null
}

async function startSessionSandbox(name: string): Promise<void> {
  const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxStartArgs(name)], {
    ignoreExitCode: true,
    timeout: ENV.SANDBOX.START_TIMEOUT_MS,
  })) as string | { exitCode: number; stdout: string; stderr: string }
  if (typeof result === 'string' || result.exitCode === 0) {
    return
  }

  const entry = findSessionSandboxEntry(await listSandboxes(), name)
  if (entry?.running) {
    return
  }
  throw new Error(`msb start failed with code ${result.exitCode}: ${result.stderr || result.stdout}`)
}

async function withStartAdmission<T>(name: string, maxRunningVms: number, run: () => Promise<T>): Promise<T> {
  const previous = startAdmission
  let release: () => void = () => {}
  startAdmission = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    await admitVmStart(name, maxRunningVms)
    return await run()
  } finally {
    release()
  }
}

async function admitVmStart(name: string, maxRunningVms: number): Promise<void> {
  const entries = await listSandboxes()
  const running: string[] = []
  for (const value of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as SandboxLsEntry
    if (typeof entry.name !== 'string' || entry.name === name) continue
    if (!SESSION_SANDBOX_NAME_PATTERN.test(entry.name)) continue
    if (sandboxEntryRunning(entry)) running.push(entry.name)
  }
  if (running.length < maxRunningVms) return

  const execTimeoutMs = ENV.SANDBOX.EXEC_TIMEOUT_MS
  const candidates = running
    .map((vmName) => ({ vmName, lastUsedAt: vmStates.get(vmName)?.lastUsedAt ?? 0 }))
    .filter((candidate) => Date.now() - candidate.lastUsedAt >= execTimeoutMs)
  if (candidates.length === 0) {
    throw new Error(
      `${running.length} sandbox VMs are already running (the limit in Settings → Sandbox is ${maxRunningVms}) and none has been idle for ${execTimeoutMs / 60000} minutes; retry when a sandboxed command finishes or raise the limit`,
    )
  }
  candidates.sort((left, right) => left.lastUsedAt - right.lastUsedAt)
  const victim = candidates[0]!
  let stopResult: { exitCode: number; stdout: string; stderr: string }
  try {
    const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxStopArgs(victim.vmName)], {
      ignoreExitCode: true,
      timeout: SANDBOX_STOP_TIMEOUT_MS,
    })) as string | { exitCode: number; stdout: string; stderr: string }
    stopResult = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
  } catch (error) {
    throw new Error(
      `could not stop idle sandbox VM ${victim.vmName} to stay within the limit of ${maxRunningVms} running sandbox VMs: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (stopResult.exitCode !== 0) {
    throw new Error(
      `could not stop idle sandbox VM ${victim.vmName} to stay within the limit of ${maxRunningVms} running sandbox VMs: ${stopResult.stderr || stopResult.stdout}`,
    )
  }
  const victimState = vmStates.get(victim.vmName)
  if (victimState !== undefined) {
    victimState.lastKnownRunningAt = null
  }
}

function ensureIdleSweepStarted(db: Database): void {
  if (idleSweepTimer !== null) return
  idleSweepStartedAt = Date.now()
  idleSweepTimer = setInterval(() => {
    void sweepIdleSandboxes(db)
  }, SANDBOX_IDLE_SWEEP_INTERVAL_MS)
  const timer = idleSweepTimer as { unref?: () => void }
  timer.unref?.()
}

async function sweepIdleSandboxes(db: Database): Promise<void> {
  if (shutdownRequested || stopInProgress) return
  const idleStopMinutes = sandboxIdleStopMinutes(db)
  const threshold = Math.max(idleStopMinutes * 60000, ENV.SANDBOX.EXEC_TIMEOUT_MS)
  let entries: SandboxLsEntry[]
  try {
    entries = await listSandboxes()
  } catch (error) {
    logger.warn(`Failed to list sandboxes for the idle sweep: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  for (const value of entries) {
    if (shutdownRequested || stopInProgress) return
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as SandboxLsEntry
    const name = entry.name
    if (typeof name !== 'string' || !SESSION_SANDBOX_NAME_PATTERN.test(name)) continue
    const state = vmStates.get(name)
    if (state !== undefined && (state.inFlightBoot !== null || state.inFlightRemoval !== null)) continue
    const lastActivity = Math.max(state?.lastUsedAt ?? 0, idleSweepStartedAt)
    if (Date.now() - lastActivity < threshold) continue
    try {
      await removeSandboxVmAndVolume(name)
      logger.info(`Removed idle sandbox ${name} and its Docker data volume`)
    } catch (error) {
      logger.warn(`Failed to remove idle sandbox ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function sandboxIdleStopMinutes(db: Database): number {
  return new SettingsService(db).getSettings('default').preferences.sandbox?.idleStopMinutes ?? DEFAULT_SANDBOX_IDLE_STOP_MINUTES
}

function sandboxMaxRunningVms(db: Database): number {
  return new SettingsService(db).getSettings('default').preferences.sandbox?.maxRunningVms ?? DEFAULT_SANDBOX_MAX_RUNNING_VMS
}

export class SandboxRuntimeService {
  constructor(
    private readonly db: Database,
    private readonly repoEnvService?: RepoEnvService,
  ) {}

  async prepareSandboxOnBoot(): Promise<void> {
    if (!this.isSandboxEnabled()) return
    const capability = detectSandboxCapability()
    if (!capability.available) return
    if (getProcessIdentityAttestationError() !== null) return
    ensureIdleSweepStarted(this.db)
    await cacheSandboxImage()
  }

  isEnabled(): boolean {
    return this.isSandboxEnabled()
  }

  getStatus(): SandboxStatus {
    const capability = detectSandboxCapability()
    const attestationError = capability.available ? getProcessIdentityAttestationError() : null
    const reason = capability.reason ?? attestationError
    return {
      available: capability.available && attestationError === null,
      enabled: this.isEnabled(),
      ...(reason !== null && reason !== undefined ? { reason } : {}),
      ...(capability.msbVersion !== undefined ? { msbVersion: capability.msbVersion } : {}),
    }
  }

  async planShell(directory: string, target: SandboxShellTarget, enforced = false): Promise<SandboxShellPlan> {
    if (!enforced && !this.isEnabled()) {
      return { mode: 'host' }
    }
    const capability = detectSandboxCapability()
    if (!capability.available) {
      return { mode: 'blocked', reason: capability.reason ?? 'Sandbox capability is unavailable' }
    }
    const attestationError = getProcessIdentityAttestationError()
    if (attestationError !== null) {
      return { mode: 'blocked', reason: attestationError }
    }
    const projectMounts = await resolveSessionSandboxMounts(target.locationDirectory)
    if (projectMounts === null) {
      return {
        mode: 'blocked',
        reason: `session directory ${target.locationDirectory} is outside the sandboxed project roots (${sandboxProjectRoots().join(', ')})`,
      }
    }
    const workDirectory = await resolveSandboxWorkDirectory(directory)
    if (workDirectory === null || !projectMounts.some((mount) => isPathWithinRoot(mount, workDirectory))) {
      return {
        mode: 'blocked',
        reason: `working directory ${directory} is outside this session's sandbox (mounted: ${projectMounts.join(', ')})`,
      }
    }
    const spec: SandboxVmSpec = {
      name: sessionSandboxName(target.rootSessionId),
      rootSessionId: target.rootSessionId,
      projectMounts,
      cpus: target.resources.cpus,
      memoryMib: target.resources.memoryMib,
    }
    const state = vmState(spec.name)
    state.lastUsedAt = Date.now()
    try {
      await ensureSessionSandbox(spec, sandboxMaxRunningVms(this.db))
      ensureIdleSweepStarted(this.db)
      state.lastUsedAt = Date.now()
      const env = {
        ...new CredentialProvider(this.db).getSandboxGitEnv({ cwd: directory }),
        ...await getGitIdentityEnvForDirectory(directory, this.db),
      }
      if (this.repoEnvService) {
        const repoEnv = await this.repoEnvService.resolveForDirectory(directory)
        Object.assign(env, repoEnv.env)
      }
      return Object.keys(env).length > 0
        ? { mode: 'sandbox', name: spec.name, workdir: workDirectory, env }
        : { mode: 'sandbox', name: spec.name, workdir: workDirectory }
    } catch (error) {
      logger.error('Failed to prepare the session sandbox', error)
      return { mode: 'blocked', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  async removeSessionSandbox(rootSessionId: string): Promise<void> {
    if (!detectSandboxCapability().available) return
    await removeSandboxVmAndVolume(sessionSandboxName(rootSessionId))
  }

  async stopAllSandboxes(): Promise<void> {
    shutdownRequested = true
    await this.stopManagedSandboxes()
  }

  async stopAllSandboxesForToggle(): Promise<void> {
    await this.stopManagedSandboxes()
  }

  private async stopManagedSandboxes(): Promise<void> {
    stopInProgress = true
    for (const state of vmStates.values()) {
      state.provisionRetryGeneration += 1
      state.backgroundProvisionRetry = null
    }
    try {
      await this.runManagedSandboxStop()
    } finally {
      stopInProgress = false
    }
  }

  private async runManagedSandboxStop(): Promise<void> {
    for (;;) {
      const inFlight = [...vmStates.values()]
        .map((state) => state.inFlightBoot)
        .filter((boot): boot is Promise<void> => boot !== null)
      if (inFlight.length === 0) break
      await Promise.all(inFlight.map((boot) => boot.catch(() => undefined)))
    }
    for (const state of vmStates.values()) {
      state.lastKnownRunningAt = null
    }
    const result = (await executeCommand([sandboxExecutablePath(), ...buildSandboxStopManagedArgs()], {
      ignoreExitCode: true,
      timeout: SANDBOX_STOP_TIMEOUT_MS,
    })) as string | { exitCode: number; stdout: string; stderr: string }
    const stopResult = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
    if (stopResult.exitCode !== 0) {
      try {
        await confirmManagedSandboxesStopped()
        logger.warn(`msb stop failed with code ${stopResult.exitCode} but the managed sandbox VMs are confirmed stopped: ${stopResult.stderr || stopResult.stdout}`)
      } catch (error) {
        logger.error('Failed to confirm the managed sandbox VMs stopped:', error)
        throw error
      }
    }
  }

  private isSandboxEnabled(): boolean {
    return new SettingsService(this.db).getSettings('default').preferences.sandbox?.enabled === true
  }
}

async function confirmManagedSandboxesStopped(): Promise<void> {
  for (const value of await listSandboxes()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as SandboxLsEntry
    if (typeof entry.name !== 'string' || !SESSION_SANDBOX_NAME_PATTERN.test(entry.name)) continue
    if (sandboxEntryRunning(entry)) {
      throw new Error('msb stop failed to stop the sandbox microVMs; a managed microVM is still running')
    }
  }
}

export async function stopSandboxesOnShutdown(db: Database): Promise<void> {
  await new SandboxRuntimeService(db).stopAllSandboxes()
}
