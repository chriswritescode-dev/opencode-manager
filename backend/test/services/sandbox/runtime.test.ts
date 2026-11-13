import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ENV, getOpenCodeAgentTmpPath, getOpenCodeGlobalSkillsPath, getOpenCodeToolOutputPath, getReposPath, getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { SettingsService } from '../../../src/services/settings'
import {
  SANDBOX_DOCKER_DATA_GUEST_PATH,
  buildSandboxStopArgs,
  buildSandboxStopManagedArgs,
  parseMemoryMib,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxExecUser,
  resolveSandboxRuntimeTmpfsSizeMib,
  sandboxDockerDataVolumeName,
  sandboxExecutablePath,
  sandboxProjectRoots,
  sessionSandboxName,
} from '../../../src/services/sandbox/command'
import {
  SandboxRuntimeService,
  backgroundProvisionRetryForTests,
  provisionSandboxExecUserForTests,
  resetSandboxRuntimeState,
  stopSandboxesOnShutdown,
  type SandboxShellTarget,
} from '../../../src/services/sandbox/runtime'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { sandboxCapabilityProbes, resetSandboxCapabilityCache } from '../../../src/services/sandbox/capability'
import type { RepoEnvService } from '../../../src/services/repo-env'
import { overrideSandboxExecutableTrustValidator } from '../../../src/services/sandbox/command'
import { forceProcessAttestation } from '../../../src/services/opencode/process-identity'
import { z } from 'zod'
import { expectLoggedMessage, resetTestLogs, testLogEntries } from '../../helpers/log-assertions'
import { FAKE_MSB_SCRIPT, FAKE_MSB_STATE_ENV } from '../../helpers/fake-msb'
import { createTestDatabase } from '../../helpers/test-database'
import { git } from '../../helpers/git-fixtures'

const originalWorkspacePath = process.env.WORKSPACE_PATH
const originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL
const originalGitConfigSystem = process.env.GIT_CONFIG_SYSTEM
const originalGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM
const suiteBinDir = mkdtempSync(path.join(realpathSync(tmpdir()), 'ocm-runtime-bin-'))
writeFileSync(path.join(suiteBinDir, 'msb'), FAKE_MSB_SCRIPT, { mode: 0o755 })
process.env.PATH = `${suiteBinDir}${path.delimiter}${process.env.PATH ?? ''}`
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_SYSTEM = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
overrideSandboxExecutableTrustValidator(() => true)
const suiteWorkspaceParent = mkdtempSync(path.join(realpathSync(tmpdir()), 'ocm-runtime-test-'))
process.env.WORKSPACE_PATH = suiteWorkspaceParent
process.env[FAKE_MSB_STATE_ENV] = path.join(suiteWorkspaceParent, 'fake-msb')

const reposRoot = getReposPath()
const worktreesRoot = getScheduleWorktreesPath()
const toolOutputRoot = getOpenCodeToolOutputPath()
const skillsRoot = getOpenCodeGlobalSkillsPath()
const agentTmpRoot = getOpenCodeAgentTmpPath()
const repoADir = path.join(reposRoot, 'repo-a')
const repoBDir = path.join(reposRoot, 'repo-b')
const worktreeDir = path.join(worktreesRoot, 'job-1-run-2')

const KVM_UNAVAILABLE_REASON =
  '/dev/kvm is not available or not writable; pass --device /dev/kvm and run on a KVM-capable Linux host'

const ROOT_SESSION = 'ses_root'
const OTHER_ROOT_SESSION = 'ses_other'
const VM_NAME = sessionSandboxName(ROOT_SESSION)
const OTHER_VM_NAME = sessionSandboxName(OTHER_ROOT_SESSION)
const SHARED_MOUNT_ROOTS = [toolOutputRoot, skillsRoot, agentTmpRoot]

const FakeVmStateSchema = z.object({
  projectMounts: z.array(z.string()),
  rootSessionId: z.string(),
  cpus: z.number(),
  memoryMib: z.number(),
  running: z.boolean(),
})

type FakeVmState = z.infer<typeof FakeVmStateSchema>

const FakeCallSchema = z.object({ argv: z.array(z.string()) })

interface FakeMountOptions {
  readonly: boolean
  noexec: boolean
  nosuid: boolean
  nodev: boolean
}

interface FakeBindMount {
  type: 'Bind'
  host: string
  guest: string
  options: FakeMountOptions
  stat_virtualization: string
  host_permissions: string
  follow_root_symlinks: boolean
  quota_mib: null
}

interface FakeTmpfsMount {
  type: 'Tmpfs'
  guest: string
  size_mib: number | null
  options: FakeMountOptions
}

interface FakeNamedMount {
  type: 'Named'
  name: string
  guest: string
  options: FakeMountOptions
  stat_virtualization: string
  host_permissions: string
  follow_root_symlinks: boolean
}

type FakeMount = FakeBindMount | FakeTmpfsMount | FakeNamedMount

interface FakeInspectConfig {
  name: string
  image: { Oci: { reference: string; root_disk?: { kind: string; size_mib: number } } }
  resources: { cpus: number; memory_mib: number; max_cpus: number; max_memory_mib: number }
  runtime: {
    workdir: string
    shell: string
    scripts: Record<string, JsonValue>
    entrypoint: string[]
    cmd: string[]
    hostname: null
    user: string
    log_level: string
    metrics_sample_interval_ms: number
    disable_metrics_sample: boolean
  }
  env: JsonValue[]
  labels: Record<string, string>
  rlimits: JsonValue[]
  mounts: FakeMount[]
  patches: JsonValue[]
  network: {
    enabled: boolean
    ports: JsonValue[]
    policy: JsonValue
    max_connections: number | null
    trust_host_cas: boolean
  }
  init: null
  pull_policy: string
  security_profile: string
  deployment_profile: string
  lifecycle: { ephemeral: boolean; max_duration_secs: null; idle_timeout_secs: null }
  manifest_digest: JsonValue
}

interface FakeNestedInspectConfig {
  spec: FakeInspectConfig
}

type FakeReportedConfig = FakeInspectConfig | FakeNestedInspectConfig

type FakeVm = FakeVmState & {
  mutate?: (config: FakeInspectConfig) => FakeReportedConfig
}

interface FakeMsbOptions {
  lsError?: string
  runError?: string
  runErrorOnce?: string
  runRequiresReplace?: string
  replaceRunError?: string
  startError?: string
  stopError?: string
  rmError?: string
  volumeError?: string
  pullError?: string
  execError?: string
  missingRemovals?: boolean
  gateInspect?: boolean
  gateStop?: boolean
  createdOverride?: { name: string; mutate: (config: FakeInspectConfig) => FakeReportedConfig }
}

const fakeMsbStateDir = path.join(suiteWorkspaceParent, 'fake-msb')

function writeJsonFile(file: string, value: JsonValue | FakeVmState | FakeReportedConfig | Record<string, FakeVmState>): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

function fakeMsbStatePath(): string {
  return path.join(fakeMsbStateDir, 'state.json')
}

function fakeMsbInvocations(): string[][] {
  const logPath = path.join(fakeMsbStateDir, 'calls.jsonl')
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => FakeCallSchema.parse(JSON.parse(line)).argv)
}

function fakeVms(): Record<string, FakeVmState> {
  const statePath = fakeMsbStatePath()
  if (!existsSync(statePath)) return {}
  return z.object({ vms: z.record(z.string(), FakeVmStateSchema) }).parse(JSON.parse(readFileSync(statePath, 'utf8'))).vms
}

function fakeVm(name: string): FakeVmState | undefined {
  return fakeVms()[name]
}

function hasFakeVm(name: string): boolean {
  return name in fakeVms()
}

function writeFakeMsbSpec(options: FakeMsbOptions = {}): void {
  writeJsonFile(path.join(fakeMsbStateDir, 'spec.json'), {
    persistentOverrides: options.createdOverride ? [options.createdOverride.name] : [],
    version: 'msb 0.6.15',
    image: ENV.SANDBOX.IMAGE,
    net: ENV.SANDBOX.NET,
    policy: resolveExpectedSandboxNetworkPolicy(ENV.SANDBOX.NET),
    execUser: resolveSandboxExecUser(),
    pathEnv: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    sharedMountRoots: SHARED_MOUNT_ROOTS,
    dockerVolumeSuffix: '-docker-data',
    dockerGuestPath: SANDBOX_DOCKER_DATA_GUEST_PATH,
    manifestDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  })
}

function writeFailureFile(key: string, stderr: string | undefined, extra: Record<string, JsonValue> = {}): void {
  if (stderr === undefined) return
  writeJsonFile(path.join(fakeMsbStateDir, `fail-${key}`), { stderr, exitCode: 1, ...extra })
}

function installFakeMsb(vms: Map<string, FakeVm>, options: FakeMsbOptions = {}): void {
  rmSync(fakeMsbStateDir, { recursive: true, force: true })
  mkdirSync(fakeMsbStateDir, { recursive: true })
  writeFakeMsbSpec(options)

  const states: Record<string, FakeVmState> = {}
  for (const [name, entry] of vms) {
    states[name] = {
      projectMounts: entry.projectMounts,
      rootSessionId: entry.rootSessionId,
      cpus: entry.cpus,
      memoryMib: entry.memoryMib,
      running: entry.running,
    }
    if (entry.mutate) {
      writeJsonFile(path.join(fakeMsbStateDir, 'vms', name, 'inspect.json'), entry.mutate(inspectConfig(entry, name)))
    }
  }
  writeJsonFile(fakeMsbStatePath(), { vms: states })

  if (options.createdOverride) {
    const template = vm()
    writeJsonFile(
      path.join(fakeMsbStateDir, 'vms', options.createdOverride.name, 'inspect.json'),
      options.createdOverride.mutate(inspectConfig(template, options.createdOverride.name)),
    )
  }

  writeFailureFile('ls', options.lsError)
  writeFailureFile('run', options.runError)
  writeFailureFile('run', options.runErrorOnce, { once: true })
  writeFailureFile('run-requires-replace', options.runRequiresReplace)
  writeFailureFile('run-replace', options.replaceRunError)
  writeFailureFile('start', options.startError)
  writeFailureFile('stop', options.stopError)
  writeFailureFile('rm', options.rmError)
  writeFailureFile('volume', options.volumeError)
  writeFailureFile('pull', options.pullError)
  writeFailureFile('exec', options.execError)
  if (options.missingRemovals) {
    writeFailureFile('rm', 'sandbox not found')
    writeFailureFile('volume', 'no such volume')
  }
  if (options.gateInspect) writeFileSync(path.join(fakeMsbStateDir, 'gate-inspect'), '1')
  if (options.gateStop) writeFileSync(path.join(fakeMsbStateDir, 'gate-stop'), '1')
}

function releaseFakeMsbGate(kind: 'inspect' | 'rm' | 'stop'): void {
  rmSync(path.join(fakeMsbStateDir, `gate-${kind}`), { force: true })
}

function openFakeMsbGate(kind: 'inspect' | 'rm' | 'stop'): void {
  mkdirSync(fakeMsbStateDir, { recursive: true })
  writeFileSync(path.join(fakeMsbStateDir, `gate-${kind}`), '1')
}

async function waitForFakeMsbGate(kind: 'inspect' | 'rm' | 'stop'): Promise<void> {
  const marker = path.join(fakeMsbStateDir, `waiting-${kind}`)
  await vi.waitFor(() => {
    expect(existsSync(marker)).toBe(true)
  }, { timeout: 5000 })
}

function vm(overrides: Partial<FakeVm> = {}): FakeVm {
  return {
    projectMounts: [repoADir],
    rootSessionId: ROOT_SESSION,
    cpus: ENV.SANDBOX.CPUS,
    memoryMib: memoryMib(),
    running: true,
    ...overrides,
  }
}

function msbCalls(subcommand: string): string[][] {
  return fakeMsbInvocations().filter((args) => args[1] === subcommand)
}

function memoryMib(): number {
  const parsed = parseMemoryMib(ENV.SANDBOX.MEMORY)
  if (parsed === null) throw new Error(`cannot parse SANDBOX_MEMORY ${ENV.SANDBOX.MEMORY}`)
  return parsed
}

function defaultResources() {
  return { cpus: ENV.SANDBOX.CPUS, memoryMib: memoryMib() }
}

function shellTarget(locationDirectory: string, resources = defaultResources()): SandboxShellTarget {
  return { rootSessionId: ROOT_SESSION, locationDirectory, resources }
}

function bindMount(host: string): FakeBindMount {
  return {
    type: 'Bind',
    host,
    guest: host,
    options: { readonly: false, noexec: false, nosuid: false, nodev: false },
    stat_virtualization: 'strict',
    host_permissions: 'private',
    follow_root_symlinks: false,
    quota_mib: null,
  }
}

function namedMount(name: string, guest: string): FakeNamedMount {
  return {
    type: 'Named',
    name,
    guest,
    options: { readonly: false, noexec: false, nosuid: false, nodev: false },
    stat_virtualization: 'strict',
    host_permissions: 'private',
    follow_root_symlinks: false,
  }
}

function tmpfsMount(guest: string, sizeMib: number | null): FakeTmpfsMount {
  return {
    type: 'Tmpfs',
    guest,
    size_mib: sizeMib,
    options: { readonly: false, noexec: false, nosuid: false, nodev: false },
  }
}

function sandboxMounts(spec: { projectMounts: string[]; memoryMib: number }, name: string): FakeMount[] {
  const mounts: FakeMount[] = []
  for (const root of [...spec.projectMounts, ...SHARED_MOUNT_ROOTS]) {
    if (!mounts.some((mount) => mount.type === 'Bind' && mount.host === root)) mounts.push(bindMount(root))
  }
  mounts.push(namedMount(sandboxDockerDataVolumeName(name), SANDBOX_DOCKER_DATA_GUEST_PATH))
  mounts.push(tmpfsMount('/tmp', resolveSandboxRuntimeTmpfsSizeMib(spec.memoryMib)))
  return mounts
}

function inspectConfig(vm: FakeVmState, name: string, overrides: Partial<FakeInspectConfig> = {}): FakeInspectConfig {
  return {
    name,
    image: { Oci: { reference: ENV.SANDBOX.IMAGE } },
    resources: { cpus: vm.cpus, memory_mib: vm.memoryMib, max_cpus: vm.cpus, max_memory_mib: vm.memoryMib },
    runtime: {
      workdir: vm.projectMounts[0] ?? '',
      shell: '/bin/sh',
      scripts: {},
      entrypoint: ['/usr/bin/env'],
      cmd: ['sleep', 'infinity'],
      hostname: null,
      user: resolveSandboxExecUser(),
      log_level: 'info',
      metrics_sample_interval_ms: 1000,
      disable_metrics_sample: false,
    },
    env: [{ key: 'PATH', value: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }],
    labels: { 'ocm.managed': 'true', 'ocm.net': ENV.SANDBOX.NET, 'ocm.session': vm.rootSessionId },
    rlimits: [],
    mounts: sandboxMounts(vm, name),
    patches: [],
    network: {
      enabled: true,
      ports: [],
      policy: resolveExpectedSandboxNetworkPolicy(ENV.SANDBOX.NET),
      max_connections: null,
      trust_host_cas: false,
    },
    init: null,
    pull_policy: 'IfMissing',
    security_profile: 'default',
    deployment_profile: 'single_tenant',
    lifecycle: { ephemeral: false, max_duration_secs: null, idle_timeout_secs: null },
    manifest_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ...overrides,
  }
}

function logMessages(level: 'info' | 'warn' | 'error'): string[] {
  return testLogEntries(level).map((entry) => entry.message)
}

const realSetTimeout = globalThis.setTimeout

async function advanceSandboxTime(ms: number): Promise<void> {
  const step = 60_000
  for (let remaining = ms; remaining > 0; remaining -= step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, remaining))
    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, 120)
    })
  }
}

const defaultProbes = { ...sandboxCapabilityProbes }

function allowCapability(version: string): void {
  sandboxCapabilityProbes.isKvmAccessible = () => true
  sandboxCapabilityProbes.resolveExecUserUid = () => null
  sandboxCapabilityProbes.readMsbVersion = () => ({ status: 0, stdout: version, stderr: '' })
  resetSandboxCapabilityCache()
}

function denyCapability(): void {
  sandboxCapabilityProbes.isKvmAccessible = () => false
  resetSandboxCapabilityCache()
}

describe('SandboxRuntimeService', () => {
  let db: Database
  let settingsService: SettingsService
  let service: SandboxRuntimeService

  function enableEnforcement(): void {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    allowCapability('msb 0.6.15')
  }

  beforeEach(() => {
    Object.assign(sandboxCapabilityProbes, defaultProbes)
    resetSandboxCapabilityCache()
    resetSandboxRuntimeState()
    resetTestLogs()
    db = createTestDatabase()
    settingsService = new SettingsService(db)
    service = new SandboxRuntimeService(db)
    mkdirSync(repoADir, { recursive: true })
    mkdirSync(repoBDir, { recursive: true })
    mkdirSync(worktreeDir, { recursive: true })
    mkdirSync(toolOutputRoot, { recursive: true })
    mkdirSync(skillsRoot, { recursive: true })
    mkdirSync(agentTmpRoot, { recursive: true })
    installFakeMsb(new Map())
  })

  afterEach(() => {
    resetSandboxRuntimeState()
    db.close()
    rmSync(repoADir, { recursive: true, force: true })
    rmSync(repoBDir, { recursive: true, force: true })
    rmSync(worktreeDir, { recursive: true, force: true })
  })

  afterAll(() => {
    if (originalWorkspacePath === undefined) delete process.env.WORKSPACE_PATH
    else process.env.WORKSPACE_PATH = originalWorkspacePath
    if (originalGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal
    if (originalGitConfigSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM
    else process.env.GIT_CONFIG_SYSTEM = originalGitConfigSystem
    if (originalGitConfigNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = originalGitConfigNoSystem
    delete process.env[FAKE_MSB_STATE_ENV]
    rmSync(suiteWorkspaceParent, { recursive: true, force: true })
    rmSync(suiteBinDir, { recursive: true, force: true })
  })

  async function expectRecreateForMutation(
    mutate: (config: FakeInspectConfig) => FakeReportedConfig,
    expectedReasonPart: string,
  ): Promise<void> {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ running: true, mutate })]])
    installFakeMsb(vms)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('rm')).toHaveLength(1)
    expect(msbCalls('run')).toHaveLength(1)
    expectLoggedMessage(expectedReasonPart, 'warn')
  }

  it('returns host mode when the preference is off', async () => {
    allowCapability('msb 0.3.1')

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'host' })
    expect(fakeMsbInvocations()).toEqual([])
  })

  it('returns blocked when the preference is on but capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    denyCapability()

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: KVM_UNAVAILABLE_REASON })
    expect(fakeMsbInvocations()).toEqual([])
  })

  it('returns the named sandbox plan for an attested running VM without listing or creating', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('inspect')).toHaveLength(1)
    expect(msbCalls('ls')).toHaveLength(0)
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('isolates two root sessions into two named VMs with distinct volumes and mounts', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([
      [VM_NAME, vm({ projectMounts: [repoADir], rootSessionId: ROOT_SESSION })],
      [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION })],
    ])
    installFakeMsb(vms)

    const first = await service.planShell(repoADir, shellTarget(repoADir))
    const second = await service.planShell(repoBDir, {
      rootSessionId: OTHER_ROOT_SESSION,
      locationDirectory: repoBDir,
      resources: defaultResources(),
    })

    expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(second).toEqual({ mode: 'sandbox', name: OTHER_VM_NAME, workdir: repoBDir })
    expect(VM_NAME).not.toBe(OTHER_VM_NAME)
    expect(sandboxDockerDataVolumeName(VM_NAME)).not.toBe(sandboxDockerDataVolumeName(OTHER_VM_NAME))
    expect(fakeVm(VM_NAME)?.projectMounts).toEqual([repoADir])
    expect(fakeVm(OTHER_VM_NAME)?.projectMounts).toEqual([repoBDir])
  })

  it('accepts a nested directory inside the session mounts', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))
    const nested = path.join(repoADir, 'src')
    mkdirSync(nested, { recursive: true })
    try {
      const plan = await service.planShell(nested, shellTarget(repoADir))
      expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: nested })
    } finally {
      rmSync(nested, { recursive: true, force: true })
    }
  })

  it('blocks a working directory outside the session mounts', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const plan = await service.planShell(repoBDir, shellTarget(repoADir))

    expect(plan).toEqual({
      mode: 'blocked',
      reason: `working directory ${repoBDir} is outside this session's sandbox (mounted: ${repoADir})`,
    })
    expect(fakeMsbInvocations()).toHaveLength(0)
  })

  it('blocks a session directory outside the sandboxed project roots', async () => {
    enableEnforcement()

    const plan = await service.planShell('/etc', shellTarget('/etc'))

    expect(plan).toEqual({
      mode: 'blocked',
      reason: `session directory /etc is outside the sandboxed project roots (${sandboxProjectRoots().join(', ')})`,
    })
  })

  it('accepts a schedule-worktree directory as its own session mount', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ projectMounts: [worktreeDir] })]])
    installFakeMsb(vms)

    const plan = await service.planShell(worktreeDir, shellTarget(worktreeDir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: worktreeDir })
  })

  it('includes the resolved git identity in the sandbox plan env', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))
    git(['init'], repoADir)
    git(['config', 'user.name', 'Local User'], repoADir)
    git(['config', 'user.email', 'local@example.com'], repoADir)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({
      mode: 'sandbox',
      name: VM_NAME,
      workdir: repoADir,
      env: {
        GIT_AUTHOR_NAME: 'Local User',
        GIT_AUTHOR_EMAIL: 'local@example.com',
        GIT_COMMITTER_NAME: 'Local User',
        GIT_COMMITTER_EMAIL: 'local@example.com',
      },
    })
  })

  it('forwards the sandbox git credentials from the plan only when the toggle allows them', async () => {
    enableEnforcement()
    settingsService.updateSettings({
      gitCredentials: [{ name: 'github', host: 'github.com', type: 'pat', token: 'ghp_plan_token' }],
      sandbox: { enabled: true, gitCredentials: true },
    })
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const withCredentials = await service.planShell(repoADir, shellTarget(repoADir))

    expect(withCredentials).toMatchObject({
      mode: 'sandbox',
      env: { GIT_CONFIG_COUNT: '1', GH_TOKEN: 'ghp_plan_token' },
    })

    settingsService.updateSettings({ sandbox: { enabled: true, gitCredentials: false } })
    const withoutCredentials = await service.planShell(repoADir, shellTarget(repoADir))

    expect(withoutCredentials.mode).toBe('sandbox')
    expect(withoutCredentials).not.toHaveProperty('env.GH_TOKEN')
    expect(withoutCredentials).not.toHaveProperty('env.GIT_CONFIG_COUNT')
  })

  it('includes the repository env in the sandbox plan env after the git env', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))
    git(['init'], repoADir)
    git(['config', 'user.name', 'Local User'], repoADir)
    git(['config', 'user.email', 'local@example.com'], repoADir)
    const repoEnvService = {
      resolveForDirectory: vi.fn(async () => ({
        env: { REPO_SECRET: 's3cret', GIT_AUTHOR_NAME: 'Repo User' },
        maskValues: ['s3cret'],
      })),
    } satisfies Pick<RepoEnvService, 'resolveForDirectory'>
    const withRepoEnv = new SandboxRuntimeService(db, repoEnvService)

    const plan = await withRepoEnv.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({
      mode: 'sandbox',
      name: VM_NAME,
      workdir: repoADir,
      env: {
        GIT_AUTHOR_NAME: 'Repo User',
        GIT_AUTHOR_EMAIL: 'local@example.com',
        GIT_COMMITTER_NAME: 'Local User',
        GIT_COMMITTER_EMAIL: 'local@example.com',
        REPO_SECRET: 's3cret',
      },
      mask: ['s3cret'],
    })
  })

  it('starts an existing stopped sandbox instead of recreating it', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ running: false })]])
    installFakeMsb(vms)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), 'start', VM_NAME])
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('rm')).toHaveLength(0)
    expect(msbCalls('inspect')).toHaveLength(2)
  })

  it('provisions the exec user passwd entry after starting a stopped sandbox', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm({ running: false })]]))

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    const provisionArgs = fakeMsbInvocations().find(
      (args) => args[1] === 'exec' && args.some((arg) => arg.includes('/etc/passwd')),
    )
    expect(provisionArgs).toBeDefined()
    if (!provisionArgs) throw new Error('expected a provisioning call')
    expect(provisionArgs[provisionArgs.indexOf('-u') + 1]).toBe('0:0')
    expect(provisionArgs).toContain(VM_NAME)
  })

  it('creates and attests a new VM when none exists', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>()
    installFakeMsb(vms)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('run')).toHaveLength(1)
    expect(fakeVm(VM_NAME)?.projectMounts).toEqual([repoADir])
    expect(fakeVm(VM_NAME)?.rootSessionId).toBe(ROOT_SESSION)
  })

  it('reuses a running sandbox whose inspect config nests the spec under config.spec', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm({ mutate: (config) => ({ spec: config }) })]]))

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('rm')).toHaveLength(0)
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('reuses a running sandbox carrying image-resolved environment variables', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm({ mutate: (config) => ({ ...config, env: [{ key: 'PATH', value: '/evil' }] }) })]]))
    const plan = await service.planShell(repoADir, shellTarget(repoADir))
    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('rm')).toHaveLength(0)
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('reuses the attested sandbox across the running cache expiry', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const first = await service.planShell(repoADir, shellTarget(repoADir))
    expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

    await new Promise((resolve) => setTimeout(resolve, 5200))

    const second = await service.planShell(repoADir, shellTarget(repoADir))
    expect(second).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('inspect')).toHaveLength(2)
    expect(msbCalls('ls')).toHaveLength(0)
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('start')).toHaveLength(0)
  }, 20000)

  it('shares one in-flight boot across concurrent plans for the same session', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const [first, second] = await Promise.all([
      service.planShell(repoADir, shellTarget(repoADir)),
      service.planShell(repoADir, shellTarget(repoADir)),
    ])

    expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(second).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('inspect')).toHaveLength(1)
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('removes and recreates a same-name sandbox that is not labelled as managed', async () => {
    await expectRecreateForMutation((config) => ({ ...config, labels: {} }), 'not labelled ocm.managed=true')
  })

  it('removes and recreates a sandbox whose session label belongs to another root session', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, labels: { 'ocm.managed': 'true', 'ocm.net': ENV.SANDBOX.NET, 'ocm.session': 'ses_intruder' } }),
      'session label',
    )
  })

  it('removes and recreates a sandbox whose cpus differ from the session resources', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, resources: { ...config.resources, cpus: ENV.SANDBOX.CPUS + 3 } }),
      'cpus',
    )
  })

  it('removes and recreates a sandbox whose memory differs from the session resources', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, resources: { ...config.resources, memory_mib: memoryMib() * 2 } }),
      'memory',
    )
  })

  it('removes and recreates a sandbox carrying an unexpected bind mount', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, mounts: [...config.mounts, bindMount('/workspace/config')] }),
      'unexpected bind mount',
    )
  })

  it('removes and recreates a sandbox whose bind mount applies noexec', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: config.mounts.map((mount) =>
          mount.type === 'Bind' && mount.host === repoADir
            ? { ...mount, options: { readonly: false, noexec: true, nosuid: false, nodev: false } }
            : mount,
        ),
      }),
      'options.noexec',
    )
  })

  it('removes and recreates a sandbox missing the runtime tmpfs at /tmp', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: config.mounts.filter((mount) => mount.type !== 'Tmpfs'),
      }),
      'missing the runtime tmpfs mount at /tmp',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs has the wrong size', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: config.mounts.map((mount) =>
          mount.type === 'Tmpfs' ? { ...mount, size_mib: (resolveSandboxRuntimeTmpfsSizeMib(memoryMib()) ?? 0) + 1 } : mount,
        ),
      }),
      'size_mib',
    )
  })

  it('removes and recreates a sandbox whose Docker data volume has an unexpected name', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: config.mounts.map((mount) =>
          mount.type === 'Named' ? { ...mount, name: 'ocm-other-docker-data' } : mount,
        ),
      }),
      'unexpected named volume mount',
    )
  })

  it('removes and recreates a sandbox missing the Docker data volume mount', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: config.mounts.filter((mount) => mount.type !== 'Named'),
      }),
      'missing the Docker data volume mount',
    )
  })

  it('removes and recreates a sandbox whose network policy allows unrestricted egress', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        network: {
          enabled: true,
          ports: [],
          policy: { default_egress: 'allow', default_ingress: 'allow', rules: [] },
          max_connections: null,
          trust_host_cas: false,
        },
      }),
      'unrestricted egress',
    )
  })

  it('removes and recreates a sandbox with networking disabled', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        network: { enabled: false, ports: [], policy: null, max_connections: null, trust_host_cas: false },
      }),
      'networking is disabled',
    )
  })

  it('removes and recreates a sandbox whose lifecycle is ephemeral', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, lifecycle: { ephemeral: true, max_duration_secs: null, idle_timeout_secs: null } }),
      'lifecycle.ephemeral',
    )
  })

  it('removes and recreates a sandbox whose runtime command differs from the canonical spec', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, runtime: { ...config.runtime, cmd: ['/bin/sh'] } }),
      'runtime.cmd',
    )
  })

  it('removes and recreates a sandbox booting a different image', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, image: { Oci: { reference: 'node:20', root_disk: { kind: 'managed', size_mib: 4096 } } } }),
      'does not match',
    )
  })

  it('removes and recreates a sandbox whose manifest digest is malformed', async () => {
    await expectRecreateForMutation((config) => ({ ...config, manifest_digest: 42 }), 'manifest digest')
  })

  it('removes and recreates a sandbox that carries image patches', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, patches: [{ type: 'env', key: 'PATH', value: '/evil' }] }),
      'patches',
    )
  })

  it('blocks planning when the configured network profile cannot be attested', async () => {
    enableEnforcement()
    const originalNet = ENV.SANDBOX.NET
    Object.defineProperty(ENV.SANDBOX, 'NET', { value: 'all', configurable: true, writable: true })
    try {
      installFakeMsb(new Map([[VM_NAME, vm()]]))
      const plan = await service.planShell(repoADir, shellTarget(repoADir))
      expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('cannot be attested') })
    } finally {
      Object.defineProperty(ENV.SANDBOX, 'NET', { value: originalNet, configurable: true, writable: true })
    }
  })

  it('blocks planning when the sandbox removal fails and never runs a create', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ mutate: (config) => ({ ...config, labels: {} }) })]])
    installFakeMsb(vms, { rmError: 'failed to kill vm: operation not permitted' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb rm failed with code 1: failed to kill vm: operation not permitted',
    })
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('rm')).toHaveLength(1)
    expectLoggedMessage('Recreating unverifiable sandbox', 'warn')
  })

  it('blocks planning when the freshly created sandbox fails attestation', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), {
      createdOverride: { name: VM_NAME, mutate: (config) => ({ ...config, labels: {} }) },
    })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('failed attestation') })
    expect(msbCalls('run')).toHaveLength(1)
  })

  it('blocks when msb ls fails during admission and never creates', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { lsError: 'failed to connect to supervisor' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb ls failed with code 1: failed to connect to supervisor',
    })
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('returns blocked with the create error when the microVM cannot be created', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { runError: 'no KVM acceleration available' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })
    expect(testLogEntries('error').length).toBeGreaterThan(0)
  })

  it('re-uses a create failure to invalidate the running cache', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { runErrorOnce: 'no KVM acceleration available' })

    const failed = await service.planShell(repoADir, shellTarget(repoADir))
    expect(failed).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })

    const retried = await service.planShell(repoADir, shellTarget(repoADir))
    expect(retried).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('run')).toHaveLength(2)
  })

  it('retries the create with --replace when msb reports the sandbox already exists', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), {
      runRequiresReplace: `error: sandbox already exists: sandbox '${VM_NAME}' already exists`,
    })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    const runs = msbCalls('run')
    expect(runs).toHaveLength(2)
    expect(runs[0]).not.toContain('--replace')
    expect(runs[1]).toContain('--replace')
    expect(hasFakeVm(VM_NAME)).toBe(true)
    expectLoggedMessage('already exists as an orphaned msb sandbox', 'warn')
  })

  it('does not retry a create that fails for another reason', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { runError: 'no KVM acceleration available' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })
    const runs = msbCalls('run')
    expect(runs).toHaveLength(1)
    expect(runs[0]).not.toContain('--replace')
    expect(logMessages('warn')).not.toContainEqual(expect.stringContaining('orphaned msb sandbox'))
  })

  it('surfaces a failing replace create as a blocked plan', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), {
      runRequiresReplace: `error: sandbox already exists: sandbox '${VM_NAME}' already exists`,
      replaceRunError: 'replace failed: sandbox busy',
    })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: replace failed: sandbox busy' })
    expect(msbCalls('run')).toHaveLength(2)
  })

  it('stops the least recently used idle VM when the running cap is reached', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
      allowCapability('msb 0.6.15')
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm({ projectMounts: [repoADir] })],
        [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION, running: false })],
      ])
      installFakeMsb(vms)

      const first = await service.planShell(repoADir, shellTarget(repoADir))
      expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

      await advanceSandboxTime(ENV.SANDBOX.EXEC_TIMEOUT_MS)

      const second = await service.planShell(repoBDir, {
        rootSessionId: OTHER_ROOT_SESSION,
        locationDirectory: repoBDir,
        resources: defaultResources(),
      })

      expect(second).toEqual({ mode: 'sandbox', name: OTHER_VM_NAME, workdir: repoBDir })
      expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), ...buildSandboxStopArgs(VM_NAME)])
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks the boot when the cap is reached and no running VM has been idle long enough', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
    allowCapability('msb 0.6.15')
    const vms = new Map<string, FakeVm>([
      [VM_NAME, vm({ projectMounts: [repoADir] })],
      [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION, running: false })],
    ])
    installFakeMsb(vms)

    await service.planShell(repoADir, shellTarget(repoADir))

    const blocked = await service.planShell(repoBDir, {
      rootSessionId: OTHER_ROOT_SESSION,
      locationDirectory: repoBDir,
      resources: defaultResources(),
    })

    expect(blocked.mode).toBe('blocked')
    expect(blocked.mode === 'blocked' ? blocked.reason : '').toContain('already running')
    expect(blocked.mode === 'blocked' ? blocked.reason : '').toContain('raise the limit')
    expect(fakeMsbInvocations()).not.toContainEqual([sandboxExecutablePath(), ...buildSandboxStopArgs(VM_NAME)])
  })

  it('blocks the boot when the idle VM cannot be stopped to make room', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
    allowCapability('msb 0.6.15')
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ projectMounts: [repoADir] })]])
    installFakeMsb(vms, { stopError: 'failed to stop vm' })

    const plan = await service.planShell(repoBDir, {
      rootSessionId: OTHER_ROOT_SESSION,
      locationDirectory: repoBDir,
      resources: defaultResources(),
    })

    expect(plan).toEqual({
      mode: 'blocked',
      reason: `could not stop idle sandbox VM ${VM_NAME} to stay within the limit of 1 running sandbox VMs: failed to stop vm`,
    })
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('start')).toHaveLength(0)
    expect(hasFakeVm(OTHER_VM_NAME)).toBe(false)
  })

  it('blocks the boot when the idle VM stop throws while making room', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
    allowCapability('msb 0.6.15')
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ projectMounts: [repoADir] })]])
    installFakeMsb(vms, { stopError: 'spawn msb ENOENT' })

    const plan = await service.planShell(repoBDir, {
      rootSessionId: OTHER_ROOT_SESSION,
      locationDirectory: repoBDir,
      resources: defaultResources(),
    })

    expect(plan).toEqual({
      mode: 'blocked',
      reason: `could not stop idle sandbox VM ${VM_NAME} to stay within the limit of 1 running sandbox VMs: spawn msb ENOENT`,
    })
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('start')).toHaveLength(0)
    expect(hasFakeVm(OTHER_VM_NAME)).toBe(false)
  })

  it('removes an idle running VM and its Docker data volume from the sweep and boots a fresh VM on the next plan', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)

      const first = await service.planShell(repoADir, shellTarget(repoADir))
      expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

      await advanceSandboxTime(31 * 60 * 1000)
      await vi.waitFor(() => {
        expect(logMessages('info')).toContain(`Removed idle sandbox ${VM_NAME} and its Docker data volume`)
      })

      expect(msbCalls('rm')).toHaveLength(1)
      expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), 'volume', 'rm', sandboxDockerDataVolumeName(VM_NAME)])
      expect(hasFakeVm(VM_NAME)).toBe(false)

      const recreated = await service.planShell(repoADir, shellTarget(repoADir))
      expect(recreated).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
      expect(msbCalls('run')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a session VM that the running cap stopped once it is idle', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
      allowCapability('msb 0.6.15')
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm({ projectMounts: [repoADir] })],
        [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION, running: false })],
      ])
      installFakeMsb(vms)

      await service.planShell(repoADir, shellTarget(repoADir))
      await advanceSandboxTime(ENV.SANDBOX.EXEC_TIMEOUT_MS)
      const second = await service.planShell(repoBDir, {
        rootSessionId: OTHER_ROOT_SESSION,
        locationDirectory: repoBDir,
        resources: defaultResources(),
      })
      expect(second).toEqual({ mode: 'sandbox', name: OTHER_VM_NAME, workdir: repoBDir })
      expect(fakeVm(VM_NAME)?.running).toBe(false)

      await advanceSandboxTime(21 * 60 * 1000)
      await vi.waitFor(() => {
        expect(hasFakeVm(VM_NAME)).toBe(false)
      })

      expect(hasFakeVm(OTHER_VM_NAME)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes an untracked session VM only after the threshold from the sweep start and never a non-session VM', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm()],
        ['ocm-workspace', vm()],
      ])
      installFakeMsb(vms)

      await service.prepareSandboxOnBoot()

      await advanceSandboxTime(20 * 60 * 1000)
      expect(hasFakeVm(VM_NAME)).toBe(true)
      expect(hasFakeVm('ocm-workspace')).toBe(true)
      expect(msbCalls('rm')).toHaveLength(0)

      await advanceSandboxTime(11 * 60 * 1000)
      await vi.waitFor(() => {
        expect(hasFakeVm(VM_NAME)).toBe(false)
      })
      expect(hasFakeVm('ocm-workspace')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not remove a VM used within the idle threshold', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)
      await service.planShell(repoADir, shellTarget(repoADir))

      await advanceSandboxTime(29 * 60 * 1000)
      await vi.waitFor(() => {
        expect(msbCalls('ls').length).toBeGreaterThan(0)
      })

      expect(hasFakeVm(VM_NAME)).toBe(true)
      expect(msbCalls('rm')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a VM with an in-flight boot during the idle sweep', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)
      await service.prepareSandboxOnBoot()
      openFakeMsbGate('inspect')

      const planning = service.planShell(repoADir, shellTarget(repoADir))
      await waitForFakeMsbGate('inspect')

      await advanceSandboxTime(31 * 60 * 1000)
      expect(hasFakeVm(VM_NAME)).toBe(true)
      expect(msbCalls('rm')).toHaveLength(0)

      releaseFakeMsbGate('inspect')
      const plan = await planning
      expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a warning and continues the sweep when a removal fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm()],
        [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION })],
      ])
      installFakeMsb(vms)
      writeFailureFile(`rm-${VM_NAME}`, 'operation not permitted')

      await service.prepareSandboxOnBoot()
      await advanceSandboxTime(31 * 60 * 1000)
      await vi.waitFor(() => {
        expect(logMessages('warn')).toContain(`Failed to remove idle sandbox ${VM_NAME}: msb rm failed with code 1: operation not permitted`)
      })

      expect(hasFakeVm(OTHER_VM_NAME)).toBe(false)
      expect(hasFakeVm(VM_NAME)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a warning when the idle sweep cannot list sandboxes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      installFakeMsb(new Map(), { lsError: 'failed to connect to supervisor' })

      await service.prepareSandboxOnBoot()
      await advanceSandboxTime(31 * 60 * 1000)
      await vi.waitFor(() => {
        expect(logMessages('warn')).toContain('Failed to list sandboxes for the idle sweep: msb ls failed with code 1: failed to connect to supervisor')
      })
      expect(msbCalls('rm')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for an in-flight removal before booting a fresh VM on the next plan', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
    installFakeMsb(vms)

    const first = await service.planShell(repoADir, shellTarget(repoADir))
    expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

    openFakeMsbGate('rm')

    const removal = service.removeSessionSandbox(ROOT_SESSION)
    await waitForFakeMsbGate('rm')

    const planning = service.planShell(repoADir, shellTarget(repoADir))
    await new Promise((resolve) => setTimeout(resolve, 0))

    releaseFakeMsbGate('rm')
    const plan = await planning
    await removal

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(hasFakeVm(VM_NAME)).toBe(true)
    expect(msbCalls('rm')).toHaveLength(1)
    expect(msbCalls('run')).toHaveLength(1)
  })

  it('runs a single removal when the same VM is removed concurrently', async () => {
    allowCapability('msb 0.6.15')
    installFakeMsb(new Map<string, FakeVm>([[VM_NAME, vm()]]))

    const first = service.removeSessionSandbox(ROOT_SESSION)
    const second = service.removeSessionSandbox(ROOT_SESSION)
    await Promise.all([first, second])

    expect(msbCalls('rm')).toHaveLength(1)
    expect(msbCalls('volume')).toHaveLength(1)
  })

  it('starts the idle sweep at boot so a stale sandbox is removed without a plan', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)

      await service.prepareSandboxOnBoot()
      await advanceSandboxTime(31 * 60 * 1000)
      await vi.waitFor(() => {
        expect(logMessages('info')).toContain(`Removed idle sandbox ${VM_NAME} and its Docker data volume`)
      })
      expect(hasFakeVm(VM_NAME)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes the VM and its Docker data volume when a root session is deleted', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
    installFakeMsb(vms)

    await service.planShell(repoADir, shellTarget(repoADir))
    expect(hasFakeVm(VM_NAME)).toBe(true)

    await service.removeSessionSandbox(ROOT_SESSION)

    expect(hasFakeVm(VM_NAME)).toBe(false)
    expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), 'volume', 'rm', sandboxDockerDataVolumeName(VM_NAME)])
  })

  it('tolerates a missing VM and volume when removing a session sandbox', async () => {
    allowCapability('msb 0.6.15')
    installFakeMsb(new Map(), { missingRemovals: true })

    await expect(service.removeSessionSandbox(ROOT_SESSION)).resolves.toBeUndefined()
  })

  it('throws when removing a session sandbox fails for another reason', async () => {
    allowCapability('msb 0.6.15')
    installFakeMsb(new Map(), { rmError: 'operation not permitted' })

    await expect(service.removeSessionSandbox(ROOT_SESSION)).rejects.toThrow('operation not permitted')
  })

  it('does not touch msb when removing a session sandbox while the capability is unavailable', async () => {
    denyCapability()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
    installFakeMsb(vms)

    await expect(service.removeSessionSandbox(ROOT_SESSION)).resolves.toBeUndefined()

    expect(fakeMsbInvocations()).toEqual([])
    expect(hasFakeVm(VM_NAME)).toBe(true)
  })

  it('caches only the guest image on boot and never touches a VM', async () => {
    enableEnforcement()

    await service.prepareSandboxOnBoot()

    expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), 'pull', ENV.SANDBOX.IMAGE])
    expect(msbCalls('inspect')).toHaveLength(0)
    expect(msbCalls('ls')).toHaveLength(0)
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('start')).toHaveLength(0)
    expect(msbCalls('exec')).toHaveLength(0)
  })

  it('never touches msb at boot when the sandbox preference is off', async () => {
    installFakeMsb(new Map())

    await service.prepareSandboxOnBoot()

    expect(fakeMsbInvocations()).toEqual([])
  })

  it('never touches msb at boot when the capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    denyCapability()

    await service.prepareSandboxOnBoot()

    expect(fakeMsbInvocations()).toEqual([])
  })

  it('surfaces a failed boot image pull to the caller', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { pullError: 'msb pull failed: registry unreachable' })

    await expect(service.prepareSandboxOnBoot()).rejects.toThrow('registry unreachable')
  })

  it('stops all managed sandboxes on shutdown even when capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    denyCapability()

    await stopSandboxesOnShutdown(db)

    expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), ...buildSandboxStopManagedArgs()])
  })

  it('stops all managed sandboxes using the label filter', async () => {
    installFakeMsb(new Map())

    await service.stopAllSandboxes()

    expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), ...buildSandboxStopManagedArgs()])
  })

  it('serializes shutdown with an in-flight boot and stops only after the boot completes', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]), { gateInspect: true })

    const planning = service.planShell(repoADir, shellTarget(repoADir))
    await waitForFakeMsbGate('inspect')

    const stopping = service.stopAllSandboxes()
    releaseFakeMsbGate('inspect')
    const plan = await planning
    await stopping

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    const calls = fakeMsbInvocations()
    const inspectIndex = calls.findIndex((args) => args[1] === 'inspect')
    const stopIndex = calls.findIndex((args) => args[1] === 'stop')
    expect(inspectIndex).toBeGreaterThanOrEqual(0)
    expect(stopIndex).toBeGreaterThan(inspectIndex)
  })

  it('refuses to boot a session sandbox once shutdown is in progress', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { gateStop: true })

    const stopping = service.stopAllSandboxes()
    await waitForFakeMsbGate('stop')

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('shutdown is in progress') })
    expect(msbCalls('run')).toHaveLength(0)
    releaseFakeMsbGate('stop')
    await stopping
  })

  it('logs a warning but succeeds when a non-zero managed stop is confirmed stopped', async () => {
    installFakeMsb(new Map([[VM_NAME, vm({ running: false })]]), { stopError: 'vm already stopped' })

    await service.stopAllSandboxes()

    expectLoggedMessage('msb stop failed with code 1', 'warn')
  })

  it('throws when the managed stop fails and a managed VM is still running', async () => {
    installFakeMsb(new Map([[VM_NAME, vm({ running: true })]]), { stopError: 'failed to stop vm' })

    await expect(service.stopAllSandboxes()).rejects.toThrow('still running')
    expect(testLogEntries('error').length).toBeGreaterThan(0)
  })

  it('throws when the managed stop fails and the sandbox state cannot be inspected', async () => {
    installFakeMsb(new Map(), { lsError: 'failed to connect to supervisor', stopError: 'failed to stop vm' })

    await expect(service.stopAllSandboxes()).rejects.toThrow('msb ls failed with code 1')
    expect(testLogEntries('error').length).toBeGreaterThan(0)
  })

  it('stops the managed sandboxes on a toggle without refusing later boots', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    await service.stopAllSandboxesForToggle()

    expect(msbCalls('stop')).toHaveLength(1)
    expect(msbCalls('run')).toHaveLength(0)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('attempts the toggle stop even when sandbox capability is unavailable', async () => {
    denyCapability()

    await service.stopAllSandboxesForToggle()

    expect(fakeMsbInvocations()).toContainEqual([sandboxExecutablePath(), ...buildSandboxStopManagedArgs()])
  })

  it('shares one in-flight attempt when exec user provisioning is requested concurrently', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const first = provisionSandboxExecUserForTests(VM_NAME)
    const second = provisionSandboxExecUserForTests(VM_NAME)

    expect(second).toBe(first)
    await Promise.all([first, second])

    const provisionCalls = msbCalls('exec').filter((args) => args.some((arg) => arg.includes('/etc/passwd')))
    expect(provisionCalls).toHaveLength(1)
  })

  it('schedules and cancels a background provisioning retry when the sandbox is stopped by a toggle', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { execError: 'Command timed out after 30000ms' })

    await service.planShell(repoADir, shellTarget(repoADir))
    const retry = backgroundProvisionRetryForTests(VM_NAME)
    expect(retry).not.toBeNull()

    await service.stopAllSandboxesForToggle()
    expect(backgroundProvisionRetryForTests(VM_NAME)).toBeNull()

    await retry
    expectLoggedMessage('background retry cancelled', 'info')
  }, 30000)

  it('logs the retry exhaustion when exec user provisioning keeps failing', async () => {
    enableEnforcement()
    installFakeMsb(new Map(), { execError: 'Command timed out after 30000ms' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expectLoggedMessage('sudo will not work inside the guest', 'warn')
    await backgroundProvisionRetryForTests(VM_NAME)
    expectLoggedMessage('provisioning retries were exhausted', 'warn')
  }, 60000)

  it('blocks planning when a session mount root is a redirected path', async () => {
    enableEnforcement()
    const target = mkdtempSync(path.join(tmpdir(), 'ocm-symlink-target-'))
    mkdirSync(path.join(target, 'repo-a'), { recursive: true })
    rmSync(reposRoot, { recursive: true, force: true })
    try {
      symlinkSync(target, reposRoot)

      const plan = await service.planShell(repoADir, shellTarget(repoADir))

      expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('refusing to mount a redirected root') })
      expect(fakeMsbInvocations().filter((args) => args[1] === 'inspect')).toHaveLength(0)
    } finally {
      rmSync(reposRoot, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
      mkdirSync(repoADir, { recursive: true })
    }
  })

  it('does not return host mode for an enforced request when the preference is disabled', async () => {
    allowCapability('msb 0.3.1')
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const plan = await service.planShell(repoADir, shellTarget(repoADir), true)

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
  })

  it('blocks an enforced request when the capability is unavailable instead of falling back to host', async () => {
    denyCapability()

    const plan = await service.planShell(repoADir, shellTarget(repoADir), true)

    expect(plan).toEqual({ mode: 'blocked', reason: KVM_UNAVAILABLE_REASON })
    expect(fakeMsbInvocations()).toEqual([])
  })

  it('blocks an enforced request when process identity cannot be attested', async () => {
    allowCapability('msb 0.6.15')
    forceProcessAttestation(false)

    try {
      const plan = await service.planShell(repoADir, shellTarget(repoADir), true)

      expect(plan).toEqual({
        mode: 'blocked',
        reason: 'process identity attestation is unavailable on this platform (Linux /proc is required)',
      })
      expect(fakeMsbInvocations()).toEqual([])
    } finally {
      forceProcessAttestation(null)
    }
  })

  it('fails closed when the capability becomes unavailable after the toggle was enabled', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const first = await service.planShell(repoADir, shellTarget(repoADir))
    expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

    denyCapability()

    const second = await service.planShell(repoADir, shellTarget(repoADir))

    expect(second).toEqual({ mode: 'blocked', reason: KVM_UNAVAILABLE_REASON })
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('reports status combining the capability probe and the preference', () => {
    allowCapability('msb 0.3.1')

    expect(service.getStatus()).toEqual({ available: true, enabled: false, msbVersion: 'msb 0.3.1' })

    settingsService.updateSettings({ sandbox: { enabled: true } })

    expect(service.getStatus()).toEqual({ available: true, enabled: true, msbVersion: 'msb 0.3.1' })

    denyCapability()

    expect(service.getStatus()).toEqual({ available: false, enabled: true, reason: KVM_UNAVAILABLE_REASON })
  })

  it('reports sandboxing unavailable when process identity cannot be attested', () => {
    allowCapability('msb 0.6.15')
    forceProcessAttestation(false)

    try {
      expect(service.getStatus()).toEqual({
        available: false,
        enabled: false,
        reason: 'process identity attestation is unavailable on this platform (Linux /proc is required)',
        msbVersion: 'msb 0.6.15',
      })
    } finally {
      forceProcessAttestation(null)
    }
  })
})
