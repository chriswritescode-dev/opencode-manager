import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ENV, getOpenCodeAgentTmpPath, getOpenCodeGlobalSkillsPath, getOpenCodeToolOutputPath, getReposPath, getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
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
import { executeCommand } from '../../../src/utils/process'
import { detectSandboxCapability } from '../../../src/services/sandbox/capability'
import { logger } from '../../../src/utils/logger'
import { forceProcessAttestation } from '../../../src/services/opencode/process-identity'
import type { RepoEnvService } from '../../../src/services/repo-env'

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/services/sandbox/capability', () => ({
  detectSandboxCapability: vi.fn(),
}))

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockExecuteCommand = executeCommand as ReturnType<typeof vi.fn>
const mockDetectSandboxCapability = detectSandboxCapability as ReturnType<typeof vi.fn>

const originalWorkspacePath = process.env.WORKSPACE_PATH
const suiteWorkspaceParent = mkdtempSync(path.join(realpathSync(tmpdir()), 'ocm-runtime-test-'))
process.env.WORKSPACE_PATH = suiteWorkspaceParent

const reposRoot = getReposPath()
const worktreesRoot = getScheduleWorktreesPath()
const toolOutputRoot = getOpenCodeToolOutputPath()
const skillsRoot = getOpenCodeGlobalSkillsPath()
const agentTmpRoot = getOpenCodeAgentTmpPath()
const repoADir = path.join(reposRoot, 'repo-a')
const repoBDir = path.join(reposRoot, 'repo-b')
const worktreeDir = path.join(worktreesRoot, 'job-1-run-2')

const ROOT_SESSION = 'ses_root'
const OTHER_ROOT_SESSION = 'ses_other'
const VM_NAME = sessionSandboxName(ROOT_SESSION)
const OTHER_VM_NAME = sessionSandboxName(OTHER_ROOT_SESSION)
const SHARED_MOUNT_ROOTS = [toolOutputRoot, skillsRoot, agentTmpRoot]

type ExecResult = { exitCode: number; stdout: string; stderr: string }

type FakeVm = {
  projectMounts: string[]
  rootSessionId: string
  cpus: number
  memoryMib: number
  running: boolean
  mutate?: (config: Record<string, unknown>) => Record<string, unknown>
}

type FakeMsbOptions = {
  lsError?: string
  runError?: string
  startError?: string
  stopError?: string
  onRun?: (name: string, vm: FakeVm) => FakeVm
}

describe('SandboxRuntimeService', () => {
  let db: Database
  let settingsService: SettingsService
  let service: SandboxRuntimeService
  let execHandler: (args: string[]) => ExecResult | Promise<ExecResult | undefined> | undefined

  beforeEach(() => {
    vi.resetAllMocks()
    resetSandboxRuntimeState()
    forceProcessAttestation(true)
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    service = new SandboxRuntimeService(db)
    mkdirSync(repoADir, { recursive: true })
    mkdirSync(repoBDir, { recursive: true })
    mkdirSync(worktreeDir, { recursive: true })
    mkdirSync(toolOutputRoot, { recursive: true })
    mkdirSync(skillsRoot, { recursive: true })
    mkdirSync(agentTmpRoot, { recursive: true })
    execHandler = () => undefined
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      const result = await execHandler(args)
      if (result !== undefined) return result
      if (args[0] === 'git') {
        return { exitCode: 1, stdout: '', stderr: 'not a git repository' }
      }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })
  })

  afterEach(() => {
    resetSandboxRuntimeState()
    db.close()
    rmSync(repoADir, { recursive: true, force: true })
    rmSync(repoBDir, { recursive: true, force: true })
    rmSync(worktreeDir, { recursive: true, force: true })
  })

  afterAll(() => {
    if (originalWorkspacePath === undefined) {
      delete process.env.WORKSPACE_PATH
    } else {
      process.env.WORKSPACE_PATH = originalWorkspacePath
    }
    rmSync(suiteWorkspaceParent, { recursive: true, force: true })
  })

  function enableEnforcement(): void {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
  }

  function memoryMib(): number {
    const parsed = parseMemoryMib(ENV.SANDBOX.MEMORY)
    if (parsed === null) throw new Error(`cannot parse SANDBOX_MEMORY ${ENV.SANDBOX.MEMORY}`)
    return parsed
  }

  function defaultResources(): { cpus: number; memoryMib: number } {
    return { cpus: ENV.SANDBOX.CPUS, memoryMib: memoryMib() }
  }

  function shellTarget(locationDirectory: string, resources = defaultResources()): SandboxShellTarget {
    return { rootSessionId: ROOT_SESSION, locationDirectory, resources }
  }

  function bindMount(host: string): Record<string, unknown> {
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

  function tmpfsMount(guest: string, sizeMib: number | null): Record<string, unknown> {
    return {
      type: 'Tmpfs',
      guest,
      size_mib: sizeMib,
      options: { readonly: false, noexec: false, nosuid: false, nodev: false },
    }
  }

  function namedMount(name: string, guest: string): Record<string, unknown> {
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

  function sandboxMounts(vm: { projectMounts: string[]; cpus: number; memoryMib: number }, name: string): Array<Record<string, unknown>> {
    const mounts: Array<Record<string, unknown>> = []
    for (const root of [...vm.projectMounts, ...SHARED_MOUNT_ROOTS]) {
      if (!mounts.some((mount) => mount.host === root)) mounts.push(bindMount(root))
    }
    mounts.push(namedMount(sandboxDockerDataVolumeName(name), SANDBOX_DOCKER_DATA_GUEST_PATH))
    mounts.push(tmpfsMount('/tmp', resolveSandboxRuntimeTmpfsSizeMib(vm.memoryMib)))
    return mounts
  }

  function inspectConfig(vm: FakeVm, name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name,
      image: { Oci: { reference: ENV.SANDBOX.IMAGE } },
      resources: { cpus: vm.cpus, memory_mib: vm.memoryMib, max_cpus: vm.cpus, max_memory_mib: vm.memoryMib },
      runtime: {
        workdir: vm.projectMounts[0],
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

  function runningInspectOutput(config: Record<string, unknown>, name: string): string {
    return JSON.stringify({
      name,
      status: 'Running',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: config,
      pending_changes: [],
    })
  }

  function stoppedInspectOutput(config: Record<string, unknown>, name: string): string {
    return JSON.stringify({
      name,
      status: 'Stopped',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: null,
      pending_changes: [],
    })
  }

  function projectMountsFromRunArgs(args: string[]): string[] {
    const mounts: string[] = []
    for (let index = 0; index < args.length; index++) {
      const value = args[index + 1]
      if (args[index] === '--mount-dir' && value !== undefined) {
        const separator = value.indexOf(':')
        mounts.push(separator >= 0 ? value.slice(0, separator) : value)
      }
    }
    const shared = new Set(SHARED_MOUNT_ROOTS)
    return mounts.filter((mount) => !shared.has(mount))
  }

  function rootSessionIdFromRunArgs(args: string[]): string {
    for (let index = 0; index < args.length; index++) {
      const value = args[index + 1]
      if (args[index] === '--label' && value !== undefined && value.startsWith('ocm.session=')) {
        return value.slice('ocm.session='.length)
      }
    }
    return ''
  }

  function resourcesFromRunArgs(args: string[]): { cpus: number; memoryMib: number } {
    const memoryValue = args[args.indexOf('-m') + 1] ?? ''
    const cpusValue = args[args.indexOf('-c') + 1] ?? ''
    return { cpus: Number(cpusValue), memoryMib: Number(memoryValue.replace(/M$/, '')) }
  }

  function installFakeMsb(vms: Map<string, FakeVm>, options: FakeMsbOptions = {}): void {
    execHandler = (args) => {
      const subcommand = args[1]
      switch (subcommand) {
        case 'inspect': {
          const name = args[2] ?? ''
          const vm = vms.get(name)
          if (vm === undefined) return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
          const base = inspectConfig(vm, name)
          const config = vm.mutate ? vm.mutate(base) : base
          return {
            exitCode: 0,
            stdout: vm.running ? runningInspectOutput(config, name) : stoppedInspectOutput(config, name),
            stderr: '',
          }
        }
        case 'ls': {
          if (options.lsError !== undefined) return { exitCode: 1, stdout: '', stderr: options.lsError }
          return {
            exitCode: 0,
            stdout: JSON.stringify([...vms].map(([name, vm]) => ({ name, status: vm.running ? 'running' : 'stopped' }))),
            stderr: '',
          }
        }
        case 'run': {
          if (options.runError !== undefined) throw new Error(`Command failed with code 1: ${options.runError}`)
          const name = args[args.indexOf('--name') + 1] ?? ''
          if (name === '') return { exitCode: 1, stdout: '', stderr: 'missing sandbox name' }
          const resources = resourcesFromRunArgs(args)
          let vm: FakeVm = {
            projectMounts: projectMountsFromRunArgs(args),
            rootSessionId: rootSessionIdFromRunArgs(args),
            cpus: resources.cpus,
            memoryMib: resources.memoryMib,
            running: true,
          }
          if (options.onRun) vm = options.onRun(name, vm)
          vms.set(name, vm)
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        case 'start': {
          if (options.startError !== undefined) return { exitCode: 1, stdout: '', stderr: options.startError }
          const vm = vms.get(args[2] ?? '')
          if (vm) vm.running = true
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        case 'stop': {
          if (options.stopError !== undefined) return { exitCode: 1, stdout: '', stderr: options.stopError }
          const vm = vms.get(args[2] ?? '')
          if (vm) vm.running = false
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        case 'rm': {
          vms.delete(args[args.length - 1] ?? '')
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        case 'volume':
        case 'ping':
        case 'exec':
        case 'pull':
          return { exitCode: 0, stdout: '', stderr: '' }
        default:
          return undefined
      }
    }
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
    return mockExecuteCommand.mock.calls
      .map((call) => call[0] as string[])
      .filter((args) => args[0] !== 'git' && args[1] === subcommand)
  }

  async function expectRecreateForMutation(
    mutate: (config: Record<string, unknown>) => Record<string, unknown>,
    expectedReasonPart: string,
  ): Promise<void> {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ running: true, mutate })]])
    installFakeMsb(vms)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('rm')).toHaveLength(1)
    expect(msbCalls('run')).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(expectedReasonPart))
  }

  it('returns host mode when the preference is off', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'host' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('returns blocked when the preference is on but capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
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
    expect(vms.get(VM_NAME)?.projectMounts).toEqual([repoADir])
    expect(vms.get(OTHER_VM_NAME)?.projectMounts).toEqual([repoBDir])
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
    expect(mockExecuteCommand.mock.calls.filter((call) => (call[0] as string[])[0] !== 'git')).toHaveLength(0)
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
    const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[0] === 'git' && args.includes('config') && args.includes('user.name')) {
        return { exitCode: 0, stdout: 'local\tfile:/repo/.git/config\tLocal User\n', stderr: '' }
      }
      if (args[0] === 'git' && args.includes('config') && args.includes('user.email')) {
        return { exitCode: 0, stdout: 'local\tfile:/repo/.git/config\tlocal@example.com\n', stderr: '' }
      }
      return baseHandler(args)
    }

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

  it('includes the repository env in the sandbox plan env after the git env', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(inspectConfig(vm(), VM_NAME), VM_NAME), stderr: '' }
      if (args.includes('config') && args.includes('user.name')) {
        return { exitCode: 0, stdout: 'local\tfile:/repo/.git/config\tLocal User\n', stderr: '' }
      }
      if (args.includes('config') && args.includes('user.email')) {
        return { exitCode: 0, stdout: 'local\tfile:/repo/.git/config\tlocal@example.com\n', stderr: '' }
      }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })
    const repoEnvService = {
      resolveForDirectory: vi.fn(async () => ({
        env: { REPO_SECRET: 's3cret', GIT_AUTHOR_NAME: 'Repo User' },
        maskValues: ['s3cret'],
        missing: [],
      })),
    } as unknown as RepoEnvService
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
    })
  })

  it('starts an existing stopped sandbox instead of recreating it', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ running: false })]])
    installFakeMsb(vms)

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'start', VM_NAME],
      expect.objectContaining({ ignoreExitCode: true }),
    )
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('rm')).toHaveLength(0)
    expect(msbCalls('inspect')).toHaveLength(2)
  })

  it('provisions the exec user passwd entry after starting a stopped sandbox', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm({ running: false })]]))

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    const provisionCall = mockExecuteCommand.mock.calls.find(
      (call) => (call[0] as string[])[1] === 'exec' && (call[0] as string[]).some((arg) => arg.includes('/etc/passwd')),
    )
    expect(provisionCall).toBeDefined()
    const provisionArgs = provisionCall![0] as string[]
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
    expect(vms.get(VM_NAME)?.projectMounts).toEqual([repoADir])
    expect(vms.get(VM_NAME)?.rootSessionId).toBe(ROOT_SESSION)
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
      (config) => ({ ...config, resources: { ...(config.resources as Record<string, unknown>), cpus: ENV.SANDBOX.CPUS + 3 } }),
      'cpus',
    )
  })

  it('removes and recreates a sandbox whose memory differs from the session resources', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, resources: { ...(config.resources as Record<string, unknown>), memory_mib: memoryMib() * 2 } }),
      'memory',
    )
  })

  it('removes and recreates a sandbox carrying an unexpected bind mount', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, mounts: [...(config.mounts as unknown[]), bindMount('/workspace/config')] }),
      'unexpected bind mount',
    )
  })

  it('removes and recreates a sandbox whose bind mount applies noexec', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: (config.mounts as Array<Record<string, unknown>>).map((mount) =>
          mount.host === repoADir ? { ...mount, options: { readonly: false, noexec: true, nosuid: false, nodev: false } } : mount,
        ),
      }),
      'options.noexec',
    )
  })

  it('removes and recreates a sandbox missing the runtime tmpfs at /tmp', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: (config.mounts as Array<Record<string, unknown>>).filter((mount) => mount.type !== 'Tmpfs'),
      }),
      'missing the runtime tmpfs mount at /tmp',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs has the wrong size', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        mounts: (config.mounts as Array<Record<string, unknown>>).map((mount) =>
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
        mounts: (config.mounts as Array<Record<string, unknown>>).map((mount) =>
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
        mounts: (config.mounts as Array<Record<string, unknown>>).filter((mount) => mount.type !== 'Named'),
      }),
      'missing the Docker data volume mount',
    )
  })

  it('removes and recreates a sandbox whose network policy allows unrestricted egress', async () => {
    await expectRecreateForMutation(
      (config) => ({
        ...config,
        network: { enabled: true, ports: [], policy: { default_egress: 'allow', default_ingress: 'allow', rules: [] } },
      }),
      'unrestricted egress',
    )
  })

  it('removes and recreates a sandbox with networking disabled', async () => {
    await expectRecreateForMutation(
      (config) => ({ ...config, network: { enabled: false, ports: [] } }),
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
      (config) => ({ ...config, runtime: { ...(config.runtime as Record<string, unknown>), cmd: ['/bin/sh'] } }),
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
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'rm') return { exitCode: 1, stdout: '', stderr: 'failed to kill vm: operation not permitted' }
      return baseHandler(args)
    }

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb rm failed with code 1: failed to kill vm: operation not permitted',
    })
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('rm')).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Recreating unverifiable sandbox'))
  })

  it('blocks planning when the freshly created sandbox fails attestation', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>()
    installFakeMsb(vms, {
      onRun: (_name, created) => ({ ...created, mutate: (config) => ({ ...config, labels: {} }) }),
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
    expect(logger.error).toHaveBeenCalled()
  })

  it('re-uses a create failure to invalidate the running cache', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>()
    let failNextRun = true
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'run' && failNextRun) {
        failNextRun = false
        throw new Error('Command failed with code 1: no KVM acceleration available')
      }
      return baseHandler(args)
    }

    const failed = await service.planShell(repoADir, shellTarget(repoADir))
    expect(failed).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })

    const retried = await service.planShell(repoADir, shellTarget(repoADir))
    expect(retried).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(msbCalls('run')).toHaveLength(2)
  })

  it('retries the create with --replace when msb reports the sandbox already exists', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>()
    installFakeMsb(vms)
    const baseHandler = execHandler
    let firstRun = true
    execHandler = (args) => {
      if (args[1] === 'run') {
        if (firstRun) {
          firstRun = false
          return { exitCode: 1, stdout: '', stderr: `error: sandbox already exists: sandbox '${VM_NAME}' already exists` }
        }
        if (!args.includes('--replace')) {
          return { exitCode: 1, stdout: '', stderr: 'retried without --replace' }
        }
      }
      return baseHandler(args)
    }

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    const runs = msbCalls('run')
    expect(runs).toHaveLength(2)
    expect(runs[0]).not.toContain('--replace')
    expect(runs[1]).toContain('--replace')
    expect(vms.has(VM_NAME)).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already exists as an orphaned msb sandbox'))
  })

  it('does not retry a create that fails for another reason', async () => {
    enableEnforcement()
    installFakeMsb(new Map())
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'run') return { exitCode: 1, stdout: '', stderr: 'no KVM acceleration available' }
      return baseHandler(args)
    }

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })
    const runs = msbCalls('run')
    expect(runs).toHaveLength(1)
    expect(runs[0]).not.toContain('--replace')
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('orphaned msb sandbox'))
  })

  it('surfaces a failing replace create as a blocked plan', async () => {
    enableEnforcement()
    installFakeMsb(new Map())
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'run') {
        if (!args.includes('--replace')) {
          return { exitCode: 1, stdout: '', stderr: `error: sandbox already exists: sandbox '${VM_NAME}' already exists` }
        }
        return { exitCode: 1, stdout: '', stderr: 'replace failed: sandbox busy' }
      }
      return baseHandler(args)
    }

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: replace failed: sandbox busy' })
    expect(msbCalls('run')).toHaveLength(2)
  })

  it('stops the least recently used idle VM when the running cap is reached', async () => {
    vi.useFakeTimers()
    try {
      settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
      mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm({ projectMounts: [repoADir] })],
        [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION, running: false })],
      ])
      installFakeMsb(vms)

      const first = await service.planShell(repoADir, shellTarget(repoADir))
      expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

      await vi.advanceTimersByTimeAsync(ENV.SANDBOX.EXEC_TIMEOUT_MS)

      const second = await service.planShell(repoBDir, {
        rootSessionId: OTHER_ROOT_SESSION,
        locationDirectory: repoBDir,
        resources: defaultResources(),
      })

      expect(second).toEqual({ mode: 'sandbox', name: OTHER_VM_NAME, workdir: repoBDir })
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        [sandboxExecutablePath(), ...buildSandboxStopArgs(VM_NAME)],
        expect.objectContaining({ ignoreExitCode: true }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks the boot when the cap is reached and no running VM has been idle long enough', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
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
    expect(mockExecuteCommand).not.toHaveBeenCalledWith(
      [sandboxExecutablePath(), ...buildSandboxStopArgs(VM_NAME)],
      expect.anything(),
    )
  })

  it('blocks the boot when the idle VM cannot be stopped to make room', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ projectMounts: [repoADir] })]])
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'stop') return { exitCode: 1, stdout: '', stderr: 'failed to stop vm' }
      return baseHandler(args)
    }

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
    expect(vms.has(OTHER_VM_NAME)).toBe(false)
  })

  it('blocks the boot when the idle VM stop throws while making room', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ projectMounts: [repoADir] })]])
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'stop') throw new Error('spawn msb ENOENT')
      return baseHandler(args)
    }

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
    expect(vms.has(OTHER_VM_NAME)).toBe(false)
  })

  it('removes an idle running VM and its Docker data volume from the sweep and boots a fresh VM on the next plan', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)

      const first = await service.planShell(repoADir, shellTarget(repoADir))
      expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

      expect(msbCalls('rm')).toHaveLength(1)
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        [sandboxExecutablePath(), 'volume', 'rm', sandboxDockerDataVolumeName(VM_NAME)],
        expect.objectContaining({ ignoreExitCode: true }),
      )
      expect(vms.has(VM_NAME)).toBe(false)
      expect(logger.info).toHaveBeenCalledWith(`Removed idle sandbox ${VM_NAME} and its Docker data volume`)

      const recreated = await service.planShell(repoADir, shellTarget(repoADir))
      expect(recreated).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
      expect(msbCalls('run')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a session VM that the running cap stopped once it is idle', async () => {
    vi.useFakeTimers()
    try {
      settingsService.updateSettings({ sandbox: { enabled: true, maxRunningVms: 1 } })
      mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm({ projectMounts: [repoADir] })],
        [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION, running: false })],
      ])
      installFakeMsb(vms)

      await service.planShell(repoADir, shellTarget(repoADir))
      await vi.advanceTimersByTimeAsync(ENV.SANDBOX.EXEC_TIMEOUT_MS)
      const second = await service.planShell(repoBDir, {
        rootSessionId: OTHER_ROOT_SESSION,
        locationDirectory: repoBDir,
        resources: defaultResources(),
      })
      expect(second).toEqual({ mode: 'sandbox', name: OTHER_VM_NAME, workdir: repoBDir })
      expect(vms.get(VM_NAME)?.running).toBe(false)

      await vi.advanceTimersByTimeAsync(21 * 60 * 1000)

      expect(vms.has(VM_NAME)).toBe(false)
      expect(vms.has(OTHER_VM_NAME)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes an untracked session VM only after the threshold from the sweep start and never a non-session VM', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm()],
        ['ocm-workspace', vm()],
      ])
      installFakeMsb(vms)

      await service.prepareSandboxOnBoot()

      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
      expect(vms.has(VM_NAME)).toBe(true)
      expect(vms.has('ocm-workspace')).toBe(true)
      expect(msbCalls('rm')).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      expect(vms.has(VM_NAME)).toBe(false)
      expect(vms.has('ocm-workspace')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not remove a VM used within the idle threshold', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)
      await service.planShell(repoADir, shellTarget(repoADir))

      await vi.advanceTimersByTimeAsync(29 * 60 * 1000)

      expect(vms.has(VM_NAME)).toBe(true)
      expect(msbCalls('rm')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a VM with an in-flight boot during the idle sweep', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)
      await service.prepareSandboxOnBoot()

      let releaseInspect: () => void = () => {}
      const inspectGate = new Promise<void>((resolve) => {
        releaseInspect = resolve
      })
      let notifyInspect: () => void = () => {}
      const inspectEntered = new Promise<void>((resolve) => {
        notifyInspect = resolve
      })
      const baseHandler = execHandler
      execHandler = async (args) => {
        if (args[1] === 'inspect') {
          notifyInspect()
          await inspectGate
        }
        return baseHandler(args)
      }

      const planning = service.planShell(repoADir, shellTarget(repoADir))
      await inspectEntered

      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
      expect(vms.has(VM_NAME)).toBe(true)
      expect(msbCalls('rm')).toHaveLength(0)

      releaseInspect()
      const plan = await planning
      expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a warning and continues the sweep when a removal fails', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([
        [VM_NAME, vm()],
        [OTHER_VM_NAME, vm({ projectMounts: [repoBDir], rootSessionId: OTHER_ROOT_SESSION })],
      ])
      installFakeMsb(vms)
      const baseHandler = execHandler
      execHandler = (args) => {
        if (args[1] === 'rm' && args[args.length - 1] === VM_NAME) {
          return { exitCode: 1, stdout: '', stderr: 'operation not permitted' }
        }
        return baseHandler(args)
      }

      await service.prepareSandboxOnBoot()
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

      expect(logger.warn).toHaveBeenCalledWith(
        `Failed to remove idle sandbox ${VM_NAME}: msb rm failed with code 1: operation not permitted`,
      )
      expect(vms.has(OTHER_VM_NAME)).toBe(false)
      expect(vms.has(VM_NAME)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a warning when the idle sweep cannot list sandboxes', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      installFakeMsb(new Map(), { lsError: 'failed to connect to supervisor' })

      await service.prepareSandboxOnBoot()
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to list sandboxes for the idle sweep: msb ls failed with code 1: failed to connect to supervisor',
      )
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

    let releaseRm: () => void = () => {}
    const rmGate = new Promise<void>((resolve) => {
      releaseRm = resolve
    })
    let notifyRm: () => void = () => {}
    const rmEntered = new Promise<void>((resolve) => {
      notifyRm = resolve
    })
    const baseHandler = execHandler
    execHandler = async (args) => {
      if (args[1] === 'rm') {
        notifyRm()
        await rmGate
      }
      return baseHandler(args)
    }

    const removal = service.removeSessionSandbox(ROOT_SESSION)
    await rmEntered

    const planning = service.planShell(repoADir, shellTarget(repoADir))
    await new Promise((resolve) => setTimeout(resolve, 0))

    releaseRm()
    const plan = await planning
    await removal

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(vms.has(VM_NAME)).toBe(true)
    expect(msbCalls('rm')).toHaveLength(1)
    expect(msbCalls('run')).toHaveLength(1)
  })

  it('runs a single removal when the same VM is removed concurrently', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    installFakeMsb(new Map<string, FakeVm>([[VM_NAME, vm()]]))

    const first = service.removeSessionSandbox(ROOT_SESSION)
    const second = service.removeSessionSandbox(ROOT_SESSION)
    await Promise.all([first, second])

    expect(msbCalls('rm')).toHaveLength(1)
    expect(msbCalls('volume')).toHaveLength(1)
  })

  it('starts the idle sweep at boot so a stale sandbox is removed without a plan', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
      installFakeMsb(vms)

      await service.prepareSandboxOnBoot()
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

      expect(vms.has(VM_NAME)).toBe(false)
      expect(logger.info).toHaveBeenCalledWith(`Removed idle sandbox ${VM_NAME} and its Docker data volume`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes the VM and its Docker data volume when a root session is deleted', async () => {
    enableEnforcement()
    const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
    installFakeMsb(vms)

    await service.planShell(repoADir, shellTarget(repoADir))
    expect(vms.has(VM_NAME)).toBe(true)

    await service.removeSessionSandbox(ROOT_SESSION)

    expect(vms.has(VM_NAME)).toBe(false)
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'volume', 'rm', sandboxDockerDataVolumeName(VM_NAME)],
      expect.objectContaining({ ignoreExitCode: true }),
    )
  })

  it('tolerates a missing VM and volume when removing a session sandbox', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    installFakeMsb(new Map())
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'rm') return { exitCode: 1, stdout: '', stderr: 'sandbox not found' }
      if (args[1] === 'volume') return { exitCode: 1, stdout: '', stderr: 'no such volume' }
      return baseHandler(args)
    }

    await expect(service.removeSessionSandbox(ROOT_SESSION)).resolves.toBeUndefined()
  })

  it('throws when removing a session sandbox fails for another reason', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    installFakeMsb(new Map())
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'rm') return { exitCode: 1, stdout: '', stderr: 'operation not permitted' }
      return baseHandler(args)
    }

    await expect(service.removeSessionSandbox(ROOT_SESSION)).rejects.toThrow('operation not permitted')
  })

  it('does not touch msb when removing a session sandbox while the capability is unavailable', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })
    const vms = new Map<string, FakeVm>([[VM_NAME, vm()]])
    installFakeMsb(vms)

    await expect(service.removeSessionSandbox(ROOT_SESSION)).resolves.toBeUndefined()

    expect(mockExecuteCommand).not.toHaveBeenCalled()
    expect(vms.has(VM_NAME)).toBe(true)
  })

  it('caches only the guest image on boot and never touches a VM', async () => {
    enableEnforcement()

    await service.prepareSandboxOnBoot()

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'pull', ENV.SANDBOX.IMAGE],
      expect.objectContaining({ timeout: ENV.SANDBOX.START_TIMEOUT_MS }),
    )
    expect(msbCalls('inspect')).toHaveLength(0)
    expect(msbCalls('ls')).toHaveLength(0)
    expect(msbCalls('run')).toHaveLength(0)
    expect(msbCalls('start')).toHaveLength(0)
    expect(msbCalls('exec')).toHaveLength(0)
  })

  it('never touches msb at boot when the sandbox preference is off', async () => {
    mockExecuteCommand.mockImplementation(async () => {
      throw new Error('msb must not be invoked when sandboxing is disabled')
    })

    await service.prepareSandboxOnBoot()

    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('never touches msb at boot when the capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    await service.prepareSandboxOnBoot()

    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('surfaces a failed boot image pull to the caller', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args[0] !== 'git' && args[1] === 'pull') throw new Error('msb pull failed: registry unreachable')
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    await expect(service.prepareSandboxOnBoot()).rejects.toThrow('registry unreachable')
  })

  it('stops all managed sandboxes on shutdown even when capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    await stopSandboxesOnShutdown(db)

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), ...buildSandboxStopManagedArgs()],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
  })

  it('stops all managed sandboxes using the label filter', async () => {
    installFakeMsb(new Map())

    await service.stopAllSandboxes()

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), ...buildSandboxStopManagedArgs()],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
  })

  it('serializes shutdown with an in-flight boot and stops only after the boot completes', async () => {
    enableEnforcement()
    let releaseInspect: () => void = () => {}
    const inspectGate = new Promise<void>((resolve) => {
      releaseInspect = resolve
    })
    installFakeMsb(new Map([[VM_NAME, vm()]]))
    const baseHandler = execHandler
    execHandler = async (args) => {
      if (args[1] === 'inspect') {
        await inspectGate
        return { exitCode: 0, stdout: runningInspectOutput(inspectConfig(vm(), VM_NAME), VM_NAME), stderr: '' }
      }
      return baseHandler(args)
    }

    const planning = service.planShell(repoADir, shellTarget(repoADir))
    await vi.waitFor(() => {
      expect(msbCalls('inspect').length).toBeGreaterThan(0)
    })

    const stopping = service.stopAllSandboxes()
    releaseInspect()
    const plan = await planning
    await stopping

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    const calls = mockExecuteCommand.mock.calls.map((call) => call[0] as string[])
    const inspectIndex = calls.findIndex((args) => args[1] === 'inspect')
    const stopIndex = calls.findIndex((args) => args[1] === 'stop')
    expect(inspectIndex).toBeGreaterThanOrEqual(0)
    expect(stopIndex).toBeGreaterThan(inspectIndex)
  })

  it('refuses to boot a session sandbox once shutdown is in progress', async () => {
    enableEnforcement()
    let releaseStop: () => void = () => {}
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    installFakeMsb(new Map())
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'stop') {
        void stopGate
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return baseHandler(args)
    }

    const stopping = service.stopAllSandboxes()
    await vi.waitFor(() => {
      expect(msbCalls('stop').length).toBeGreaterThan(0)
    })

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('shutdown is in progress') })
    expect(msbCalls('run')).toHaveLength(0)
    releaseStop()
    await stopping
  })

  it('logs a warning but succeeds when a non-zero managed stop is confirmed stopped', async () => {
    const vms = new Map<string, FakeVm>([[VM_NAME, vm({ running: false })]])
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'stop') return { exitCode: 1, stdout: '', stderr: 'vm already stopped' }
      return baseHandler(args)
    }

    await service.stopAllSandboxes()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('msb stop failed with code 1'))
  })

  it('throws when the managed stop fails and a managed VM is still running', async () => {
    installFakeMsb(new Map([[VM_NAME, vm({ running: true })]]))
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'stop') return { exitCode: 1, stdout: '', stderr: 'failed to stop vm' }
      return baseHandler(args)
    }

    await expect(service.stopAllSandboxes()).rejects.toThrow('still running')
    expect(logger.error).toHaveBeenCalled()
  })

  it('throws when the managed stop fails and the sandbox state cannot be inspected', async () => {
    installFakeMsb(new Map(), { lsError: 'failed to connect to supervisor' })
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'stop') return { exitCode: 1, stdout: '', stderr: 'failed to stop vm' }
      return baseHandler(args)
    }

    await expect(service.stopAllSandboxes()).rejects.toThrow('msb ls failed with code 1')
    expect(logger.error).toHaveBeenCalled()
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
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    await service.stopAllSandboxesForToggle()

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), ...buildSandboxStopManagedArgs()],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
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
    const vms = new Map<string, FakeVm>()
    installFakeMsb(vms)
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'exec') throw new Error('Command timed out after 30000ms')
      return baseHandler(args)
    }

    await service.planShell(repoADir, shellTarget(repoADir))
    const retry = backgroundProvisionRetryForTests(VM_NAME)
    expect(retry).not.toBeNull()

    await service.stopAllSandboxesForToggle()
    expect(backgroundProvisionRetryForTests(VM_NAME)).toBeNull()

    await retry
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('background retry cancelled'))
  }, 30000)

  it('logs the retry exhaustion when exec user provisioning keeps failing', async () => {
    enableEnforcement()
    installFakeMsb(new Map())
    const baseHandler = execHandler
    execHandler = (args) => {
      if (args[1] === 'exec') throw new Error('Command timed out after 30000ms')
      return baseHandler(args)
    }

    const plan = await service.planShell(repoADir, shellTarget(repoADir))

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sudo will not work inside the guest'))
    await backgroundProvisionRetryForTests(VM_NAME)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('provisioning retries were exhausted'))
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
      expect(mockExecuteCommand.mock.calls.filter((call) => (call[0] as string[])[1] === 'inspect')).toHaveLength(0)
    } finally {
      rmSync(reposRoot, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
      mkdirSync(repoADir, { recursive: true })
    }
  })

  it('does not return host mode for an enforced request when the preference is disabled', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const plan = await service.planShell(repoADir, shellTarget(repoADir), true)

    expect(plan).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })
  })

  it('blocks an enforced request when the capability is unavailable instead of falling back to host', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const plan = await service.planShell(repoADir, shellTarget(repoADir), true)

    expect(plan).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('blocks an enforced request when process identity cannot be attested', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    forceProcessAttestation(false)

    try {
      const plan = await service.planShell(repoADir, shellTarget(repoADir), true)

      expect(plan).toEqual({
        mode: 'blocked',
        reason: 'process identity attestation is unavailable on this platform (Linux /proc is required)',
      })
      expect(mockExecuteCommand).not.toHaveBeenCalled()
    } finally {
      forceProcessAttestation(null)
    }
  })

  it('fails closed when the capability becomes unavailable after the toggle was enabled', async () => {
    enableEnforcement()
    installFakeMsb(new Map([[VM_NAME, vm()]]))

    const first = await service.planShell(repoADir, shellTarget(repoADir))
    expect(first).toEqual({ mode: 'sandbox', name: VM_NAME, workdir: repoADir })

    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available or not writable' })

    const second = await service.planShell(repoADir, shellTarget(repoADir))

    expect(second).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available or not writable' })
    expect(msbCalls('run')).toHaveLength(0)
  })

  it('reports status combining the capability probe and the preference', () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })

    expect(service.getStatus()).toEqual({ available: true, enabled: false, msbVersion: 'msb 0.3.1' })

    settingsService.updateSettings({ sandbox: { enabled: true } })

    expect(service.getStatus()).toEqual({ available: true, enabled: true, msbVersion: 'msb 0.3.1' })

    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    expect(service.getStatus()).toEqual({ available: false, enabled: true, reason: '/dev/kvm is not available' })
  })

  it('reports sandboxing unavailable when process identity cannot be attested', () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
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
