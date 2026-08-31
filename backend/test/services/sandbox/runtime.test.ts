import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ENV, getAssistantOpenCodeDir, getOpenCodeAgentTmpPath, getOpenCodeGlobalSkillsPath, getOpenCodeToolOutputPath, getReposPath, getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { SettingsService } from '../../../src/services/settings'
import { buildSandboxInspectArgs, resolveSandboxExecUser, resolveSandboxRuntimeTmpfsSizeMib, sandboxExecutablePath, WORKSPACE_SANDBOX_NAME } from '../../../src/services/sandbox/command'
import { SandboxRuntimeService, backgroundProvisionRetryForTests, provisionSandboxExecUserForTests, resetSandboxRuntimeState, stopWorkspaceSandboxOnShutdown } from '../../../src/services/sandbox/runtime'
import { executeCommand } from '../../../src/utils/process'
import { detectSandboxCapability } from '../../../src/services/sandbox/capability'
import { logger } from '../../../src/utils/logger'
import { forceProcessAttestation } from '../../../src/services/opencode/process-identity'

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

describe('SandboxRuntimeService', () => {
  let db: Database
  let settingsService: SettingsService
  let service: SandboxRuntimeService

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
  })

  afterEach(() => {
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
    const match = /^(\d+(?:\.\d+)?)([gGmM])?$/.exec(ENV.SANDBOX.MEMORY)
    if (match === null) throw new Error(`cannot parse SANDBOX_MEMORY ${ENV.SANDBOX.MEMORY}`)
    const number = Number(match[1])
    return match[2] === undefined || match[2] === 'M' || match[2] === 'm' ? Math.floor(number) : Math.floor(number * 1024)
  }

  function runtimeTmpfsSizeMib(): number {
    const sizeMib = resolveSandboxRuntimeTmpfsSizeMib(memoryMib())
    if (sizeMib === null) throw new Error(`cannot derive runtime tmpfs size from SANDBOX_MEMORY ${ENV.SANDBOX.MEMORY}`)
    return sizeMib
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

  function realInspectConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: WORKSPACE_SANDBOX_NAME,
      image: { Oci: { reference: ENV.SANDBOX.IMAGE } },
      resources: { cpus: ENV.SANDBOX.CPUS, memory_mib: memoryMib(), max_cpus: ENV.SANDBOX.CPUS, max_memory_mib: memoryMib() },
      runtime: {
        workdir: reposRoot,
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
      env: [
        { key: 'PATH', value: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
        { key: 'NODE_VERSION', value: '24.13.0' },
      ],
      labels: { 'ocm.managed': 'true', 'ocm.net': ENV.SANDBOX.NET },
      rlimits: [],
      mounts: [
        bindMount(reposRoot),
        bindMount(worktreesRoot),
        bindMount(toolOutputRoot),
        bindMount(skillsRoot),
        bindMount(agentTmpRoot),
        tmpfsMount('/tmp', runtimeTmpfsSizeMib()),
      ],
      patches: [],
      network: {
        enabled: true,
        ports: [],
        policy: {
          default_egress: 'deny',
          default_ingress: 'allow',
          rules: [
            { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
            { direction: 'egress', destination: { group: 'public' }, protocols: [], ports: [], action: 'allow' },
          ],
        },
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

  function trustedInspectOutput(): string {
    return JSON.stringify({
      name: WORKSPACE_SANDBOX_NAME,
      status: 'Stopped',
      config: realInspectConfig(),
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: null,
      pending_changes: [],
    })
  }

  function runningInspectOutput(config: Record<string, unknown>): string {
    return JSON.stringify({
      name: WORKSPACE_SANDBOX_NAME,
      status: 'Running',
      config,
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
      active_config: config,
      pending_changes: [],
    })
  }

  function stoppedListingOutput(): string {
    return JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'stopped' }])
  }

  function inspectedRunningSandbox(): { exitCode: number; stdout: string; stderr: string } {
    return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
  }

  function attestedAfterRecreate(untrusted: { exitCode: number; stdout: string; stderr: string }): { exitCode: number; stdout: string; stderr: string } {
    if (mockExecuteCommand.mock.calls.some((call) => call[0].includes('run'))) {
      return inspectedRunningSandbox()
    }
    return untrusted
  }

  it('returns host mode when the preference is off', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'host' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('returns blocked when the preference is on but capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('sandbox mode wraps the command with the caller working directory', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const directory = repoADir
    const plan = await service.planShell(directory)

    expect(plan).toEqual({ mode: 'sandbox', workdir: directory })
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), ...buildSandboxInspectArgs()],
      expect.objectContaining({ ignoreExitCode: true, silent: true }),
    )
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('boots the microVM once for concurrent plans in different repo directories', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const dirA = repoADir
    const dirB = repoBDir
    const [planA, planB] = await Promise.all([
      service.planShell(dirA),
      service.planShell(dirB),
    ])

    expect(planA).toEqual({ mode: 'sandbox', workdir: dirA })
    expect(planB).toEqual({ mode: 'sandbox', workdir: dirB })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('accepts a schedule-worktree directory', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const directory = worktreeDir
    const plan = await service.planShell(directory)

    expect(plan).toEqual({ mode: 'sandbox', workdir: directory })
  })

  it('starts an existing stopped sandbox instead of recreating it', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: stoppedListingOutput(), stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 0, stdout: trustedInspectOutput(), stderr: '' }
        }
        return inspectedRunningSandbox()
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'start', WORKSPACE_SANDBOX_NAME],
      expect.objectContaining({ ignoreExitCode: true }),
    )
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(2)
  })

  it('provisions the exec user passwd entry after starting a stopped sandbox', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: stoppedListingOutput(), stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 0, stdout: trustedInspectOutput(), stderr: '' }
        }
        return inspectedRunningSandbox()
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    const provisionCall = mockExecuteCommand.mock.calls.find((call) => call[0].includes('exec'))
    expect(provisionCall).toBeDefined()
    const provisionArgs = provisionCall![0]
    expect(provisionArgs[provisionArgs.indexOf('-u') + 1]).toBe('0:0')
    expect(provisionArgs.join(' ')).toContain('getent passwd')
  })

  it('leaves an already running workspace sandbox in place at boot and provisions its exec user', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return inspectedRunningSandbox()
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    await service.prepareWorkspaceSandboxOnBoot()

    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    const provisionCall = mockExecuteCommand.mock.calls.find((call) => call[0].includes('exec'))
    expect(provisionCall).toBeDefined()
    const provisionArgs = provisionCall![0]
    expect(provisionArgs[provisionArgs.indexOf('-u') + 1]).toBe('0:0')
  })

  it('creates the shared microVM at boot when none exists yet', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
        }
        return inspectedRunningSandbox()
      }
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    await service.prepareWorkspaceSandboxOnBoot()

    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.find((call) => call[0].includes('exec'))).toBeDefined()
  })

  it('starts a stopped microVM at boot instead of waiting for the first command', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: stoppedListingOutput(), stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 0, stdout: trustedInspectOutput(), stderr: '' }
        }
        return inspectedRunningSandbox()
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    await service.prepareWorkspaceSandboxOnBoot()

    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.find((call) => call[0].includes('exec'))).toBeDefined()
  })

  it('waits for the guest agent before provisioning the exec user', async () => {
    enableEnforcement()
    let pingCalls = 0
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ping')) {
        pingCalls += 1
        if (pingCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'agent unreachable' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
        }
        return inspectedRunningSandbox()
      }
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(pingCalls).toBeGreaterThanOrEqual(2)
    const pingIndex = mockExecuteCommand.mock.calls.findIndex((call) => call[0].includes('ping'))
    const provisionIndex = mockExecuteCommand.mock.calls.findIndex((call) => call[0].includes('exec'))
    expect(pingIndex).toBeLessThan(provisionIndex)
  })

  it('keeps the sandbox usable when exec user provisioning fails', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('exec')) {
        throw new Error('Command timed out after 30000ms')
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
        }
        return inspectedRunningSandbox()
      }
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sudo will not work inside the guest'))
    await backgroundProvisionRetryForTests()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('provisioning retries were exhausted'),
    )
  }, 60000)

  it('provisions the exec user via the background retry after an initial failure', async () => {
    enableEnforcement()
    let planDone = false
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('exec')) {
        if (!planDone) {
          throw new Error('Command timed out after 30000ms')
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
        }
        return inspectedRunningSandbox()
      }
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)
    planDone = true

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    await backgroundProvisionRetryForTests()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('provisioned by the background retry'))
  }, 30000)

  it('never touches msb at boot when the sandbox preference is off', async () => {
    mockExecuteCommand.mockImplementation(async () => {
      throw new Error('msb must not be invoked when sandboxing is disabled')
    })

    await service.prepareWorkspaceSandboxOnBoot()

    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('caches the guest image at boot before touching the microVM', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return inspectedRunningSandbox()
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: stoppedListingOutput(), stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    await service.prepareWorkspaceSandboxOnBoot()

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'pull', ENV.SANDBOX.IMAGE],
      expect.objectContaining({ timeout: ENV.SANDBOX.START_TIMEOUT_MS }),
    )
    const pullIndex = mockExecuteCommand.mock.calls.findIndex((call) => call[0].includes('pull'))
    const inspectIndex = mockExecuteCommand.mock.calls.findIndex((call) => call[0].includes('inspect'))
    expect(pullIndex).toBe(0)
    expect(pullIndex).toBeLessThan(inspectIndex)
  })

  it('surfaces a failed boot image pull to the caller and never boots the microVM', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('pull')) {
        throw new Error('msb pull failed: registry unreachable')
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    await expect(service.prepareWorkspaceSandboxOnBoot()).rejects.toThrow('registry unreachable')
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('returns blocked with the start stderr when a stopped sandbox fails to start', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: stoppedListingOutput(), stderr: '' }
      }
      if (args.includes('inspect')) {
        return { exitCode: 0, stdout: trustedInspectOutput(), stderr: '' }
      }
      return { exitCode: 1, stdout: '', stderr: 'vm kernel failed to boot: no memory' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb start failed with code 1: vm kernel failed to boot: no memory',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('tolerates a non-zero start exit when the follow-up listing shows the sandbox running', async () => {
    enableEnforcement()
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: trustedInspectOutput(), stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'already running' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce(inspectedRunningSandbox())

    const directory = repoADir
    const plan = await service.planShell(directory)

    expect(plan).toEqual({ mode: 'sandbox', workdir: directory })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('removes and recreates a stopped sandbox whose effective config becomes unsafe after start', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: stoppedListingOutput(), stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 0, stdout: trustedInspectOutput(), stderr: '' }
        }
        if (inspectCalls === 2) {
          return {
            exitCode: 0,
            stdout: runningInspectOutput(
              realInspectConfig({
                mounts: [
                  bindMount(reposRoot),
                  bindMount(worktreesRoot),
                  bindMount(toolOutputRoot),
                  bindMount(skillsRoot),
                  bindMount(agentTmpRoot),
                  bindMount('/workspace/config'),
                ],
              }),
            ),
            stderr: '',
          }
        }
        return inspectedRunningSandbox()
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed running attestation'))
  })

  it('provisions the exec user passwd entry over a root exec after creating the sandbox', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
        }
        return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    const provisionCall = mockExecuteCommand.mock.calls.find((call) => call[0].includes('exec'))
    expect(provisionCall).toBeDefined()
    const provisionArgs = provisionCall![0]
    expect(provisionArgs[provisionArgs.indexOf('-u') + 1]).toBe('0:0')
    const provisionScript = provisionArgs.join(' ')
    expect(provisionScript).toContain('getent group')
    expect(provisionScript).toContain('getent passwd')
    expect(provisionScript).toContain('/home/ocm-agent')
  })

  it('blocks a signal-terminated start and never caches the sandbox as running without proof', async () => {
    enableEnforcement()
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: trustedInspectOutput(), stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Command terminated by signal SIGKILL' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: stoppedListingOutput(), stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: trustedInspectOutput(), stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Command terminated by signal SIGKILL' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: stoppedListingOutput(), stderr: '' })

    const first = await service.planShell(repoADir)

    expect(first).toEqual({
      mode: 'blocked',
      reason: 'msb start failed with code 1: Command terminated by signal SIGKILL',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)

    const retried = await service.planShell(repoADir)

    expect(retried).toEqual({
      mode: 'blocked',
      reason: 'msb start failed with code 1: Command terminated by signal SIGKILL',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(2)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(2)
  })

  it('removes and recreates a same-name sandbox that is not labelled as managed', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ labels: {} })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'rm', '--force', WORKSPACE_SANDBOX_NAME],
      expect.objectContaining({ ignoreExitCode: true }),
    )
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Recreating unverifiable sandbox'),
    )
  })

  it('removes and recreates a same-name sandbox that carries secret-bearing mounts', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'stopped' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Stopped',
            config: realInspectConfig({
              mounts: [
                bindMount(reposRoot),
                bindMount(worktreesRoot),
                bindMount(toolOutputRoot),
                bindMount(skillsRoot),
                bindMount(agentTmpRoot),
                bindMount('/workspace/config'),
              ],
            }),
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected bind mount'))
  })

  it('removes and recreates a same-name sandbox that carries a tmpfs over a project root', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            mounts: [
              bindMount(reposRoot),
              bindMount(worktreesRoot),
              bindMount(toolOutputRoot),
              bindMount(skillsRoot),
              bindMount(agentTmpRoot),
              tmpfsMount(reposRoot, 512),
            ],
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected tmpfs mount'))
  })

  it('removes and recreates a running sandbox whose active config carries secret bindings', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        const base = realInspectConfig()
        const network = base.network as Record<string, unknown>
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Running',
            config: realInspectConfig(),
            active_config: realInspectConfig({
              network: {
                ...network,
                secrets: {
                  secrets: [{ env_var: 'GITHUB_TOKEN', placeholder: '$MSB_GITHUB_TOKEN', allowed_hosts: ['api.github.com'] }],
                  on_violation: 'block',
                },
              },
            }),
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network.secrets must be empty'))
  })

  it('removes and recreates a stopped sandbox whose stored config carries secret bindings', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'stopped' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        const base = realInspectConfig()
        const network = base.network as Record<string, unknown>
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Stopped',
            config: realInspectConfig({
              network: {
                ...network,
                secrets: {
                  secrets: [{ env_var: 'GITHUB_TOKEN', placeholder: '$MSB_GITHUB_TOKEN', allowed_hosts: ['api.github.com'] }],
                  on_violation: 'block',
                },
              },
            }),
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network.secrets must be empty'))
  })

  it('removes and recreates a running sandbox whose active config has malformed secret bindings', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        const base = realInspectConfig()
        const network = base.network as Record<string, unknown>
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Running',
            config: realInspectConfig(),
            active_config: realInspectConfig({
              network: { ...network, secrets: 'tampered' },
            }),
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network.secrets is malformed'))
  })

  it('reuses a running sandbox whose active config carries an empty secrets subdocument', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        const base = realInspectConfig()
        const network = base.network as Record<string, unknown>
        return {
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: { ...network, secrets: { secrets: [], on_violation: 'block' } },
          })),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('removes and recreates a same-name sandbox that carries a tmpfs over a nested repo path', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            mounts: [
              bindMount(reposRoot),
              bindMount(worktreesRoot),
              bindMount(toolOutputRoot),
              bindMount(skillsRoot),
              bindMount(agentTmpRoot),
              tmpfsMount(path.join(reposRoot, 'repo-a', 'src'), 512),
            ],
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected tmpfs mount'))
  })

  it('removes and recreates a running sandbox whose active config carries a secret-bearing mount even when the stored config is safe', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Running',
            config: realInspectConfig(),
            active_config: realInspectConfig({
              mounts: [
                bindMount(reposRoot),
                bindMount(worktreesRoot),
                bindMount(toolOutputRoot),
                bindMount(skillsRoot),
                bindMount(agentTmpRoot),
                bindMount('/workspace/config'),
              ],
            }),
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected bind mount'))
  })

  it('removes and recreates a running sandbox whose active configuration is missing or malformed', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Running',
            config: realInspectConfig(),
            active_config: null,
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no active configuration'))
  })

  it('removes and recreates a running sandbox whose active configuration is not an object', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Running',
            config: realInspectConfig(),
            active_config: 'not-a-config',
          }),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected config shape'))
  })

  it('reuses a running sandbox whose stored config is unsafe but whose active config is fully attested', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            name: WORKSPACE_SANDBOX_NAME,
            status: 'Running',
            config: realInspectConfig({
              mounts: [
                bindMount(reposRoot),
                bindMount(worktreesRoot),
                bindMount(toolOutputRoot),
                bindMount(skillsRoot),
                bindMount(agentTmpRoot),
                bindMount('/workspace/config'),
              ],
            }),
            active_config: realInspectConfig(),
          }),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('reuses a fully attested running sandbox without removing, recreating, or starting it', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('reuses a running sandbox carrying the explicit /usr/bin/env runtime entrypoint', async () => {
    enableEnforcement()
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return {
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ runtime: { ...runtime, entrypoint: ['/usr/bin/env'] } })),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('reuses a running sandbox carrying the microsandbox runtime tmpfs at /tmp sized from the canonical memory', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return {
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            mounts: [
              bindMount(reposRoot),
              bindMount(worktreesRoot),
              bindMount(toolOutputRoot),
              bindMount(skillsRoot),
              bindMount(agentTmpRoot),
              tmpfsMount('/tmp', runtimeTmpfsSizeMib()),
            ],
          })),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
  })

  it('reuses a sandbox whose inspect config nests the spec under config.spec', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return { exitCode: 0, stdout: runningInspectOutput({ spec: realInspectConfig() }), stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('accepts the full image-resolved v0.6.15 config shape without recreating the sandbox', async () => {
    enableEnforcement()
    const resolvedConfig = realInspectConfig({
      image: {
        Oci: {
          reference: ENV.SANDBOX.IMAGE,
          root_disk: { kind: 'tmpfs', size_mib: null },
        },
      },
      runtime: { ...(realInspectConfig().runtime as Record<string, unknown>), log_level: 'debug' },
      labels: { 'ocm.managed': 'true', 'ocm.net': ENV.SANDBOX.NET, 'org.opencontainers.image.ref.name': ENV.SANDBOX.IMAGE },
    })
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return { exitCode: 0, stdout: runningInspectOutput(resolvedConfig), stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('removes and recreates a sandbox whose OCI root disk attaches a host disk image', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            image: { Oci: { reference: ENV.SANDBOX.IMAGE, root_disk: { kind: 'disk-image', path: '/workspace/config/id_rsa', format: 'raw', fstype: null } } },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('host disk image'))
  })

  it('removes and recreates a sandbox whose network policy allows unrestricted egress', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: {
              enabled: true,
              ports: [],
              policy: { default_egress: 'allow', default_ingress: 'allow', rules: [] },
              max_connections: null,
              trust_host_cas: false,
            },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unrestricted egress'))
  })

  it('removes and recreates a sandbox whose network policy adds an allow-all rule', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: {
              enabled: true,
              ports: [],
              policy: {
                default_egress: 'deny',
                default_ingress: 'allow',
                rules: [
                  { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
                  { direction: 'egress', destination: { any: true }, protocols: [], ports: [], action: 'allow' },
                ],
              },
              max_connections: null,
              trust_host_cas: false,
            },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network policy'))
  })

  it('removes and recreates a sandbox whose network policy keeps rules from a broader profile', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: {
              enabled: true,
              ports: [],
              policy: {
                default_egress: 'deny',
                default_ingress: 'allow',
                rules: [
                  { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
                  { direction: 'egress', destination: { group: 'public' }, protocols: [], ports: [], action: 'allow' },
                  { direction: 'egress', destination: { group: 'private' }, protocols: [], ports: [], action: 'allow' },
                ],
              },
              max_connections: null,
              trust_host_cas: false,
            },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network policy'))
  })

  it('removes and recreates a sandbox whose network policy is missing a required rule', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: {
              enabled: true,
              ports: [],
              policy: {
                default_egress: 'deny',
                default_ingress: 'allow',
                rules: [
                  { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
                ],
              },
              max_connections: null,
              trust_host_cas: false,
            },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network policy'))
  })

  it('removes and recreates a sandbox whose network policy changes the ingress default', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: {
              enabled: true,
              ports: [],
              policy: {
                default_egress: 'deny',
                default_ingress: 'deny',
                rules: [
                  { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
                  { direction: 'egress', destination: { group: 'public' }, protocols: [], ports: [], action: 'allow' },
                ],
              },
              max_connections: null,
              trust_host_cas: false,
            },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('default_ingress'))
  })

  it('removes and recreates a sandbox whose network policy is missing entirely', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            network: { enabled: true, ports: [], max_connections: null, trust_host_cas: false },
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network policy'))
  })

  it('blocks planning when the configured network profile cannot be attested', async () => {
    enableEnforcement()
    const originalNet = ENV.SANDBOX.NET
    Object.defineProperty(ENV.SANDBOX, 'NET', { value: 'all', configurable: true, writable: true })
    try {
      mockExecuteCommand.mockImplementation(async (args: string[]) => {
        if (args.includes('ls')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
            stderr: '',
          }
        }
        if (args.includes('inspect')) {
          return {
            exitCode: 0,
            stdout: runningInspectOutput(realInspectConfig()),
            stderr: '',
          }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const plan = await service.planShell(repoADir)

      expect(plan).toEqual({
        mode: 'blocked',
        reason: expect.stringContaining('cannot be attested'),
      })
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    } finally {
      Object.defineProperty(ENV.SANDBOX, 'NET', { value: originalNet, configurable: true, writable: true })
    }
  })

  it('removes and recreates a same-name sandbox booting a different image', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ image: { Oci: { reference: 'node:20', root_disk: { kind: 'managed', size_mib: 4096 } } } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match'))
  })

  it('removes and recreates a same-name sandbox with networking disabled', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ network: { enabled: false, ports: [] } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('networking is disabled'))
  })

  it('removes and recreates a same-name sandbox whose network profile label mismatches the configured profile', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ labels: { 'ocm.managed': 'true', 'ocm.net': 'private' } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network profile'))
  })

  it('removes and recreates a same-name sandbox created before the network profile label existed', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ labels: { 'ocm.managed': 'true' } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network profile'))
  })

  it('reuses the attested sandbox across cache expiry without removing, recreating, or starting it', async () => {
    vi.useFakeTimers()
    try {
      enableEnforcement()
      mockExecuteCommand.mockImplementation(async (args: string[]) => {
        if (args.includes('ls')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
            stderr: '',
          }
        }
        if (args.includes('inspect')) {
          return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const first = await service.planShell(repoADir)
      expect(first).toEqual({ mode: 'sandbox', workdir: repoADir })

      vi.advanceTimersByTime(6000)

      const second = await service.planShell(repoBDir)
      expect(second).toEqual({ mode: 'sandbox', workdir: repoBDir })

      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(0)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(2)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes and recreates when msb inspect output cannot be parsed', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({ exitCode: 0, stdout: '{"config": truncated', stderr: '' })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed JSON'))
  })

  it('removes and recreates when msb inspect fails', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({ exitCode: 1, stdout: '', stderr: 'sandbox not found' })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('msb inspect failed with code 1'))
  })

  it('returns blocked when msb ls fails and never attempts a create', async () => {
    enableEnforcement()
    mockExecuteCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'failed to connect to supervisor' })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb ls failed with code 1: failed to connect to supervisor',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('returns blocked when msb ls emits malformed JSON and never attempts a create', async () => {
    enableEnforcement()
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '{"error":"truncated', stderr: '' })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb ls returned malformed JSON ({"error":"truncated)',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('returns blocked when msb ls does not emit a top-level array and never attempts a create', async () => {
    enableEnforcement()
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '{"name":"ocm-workspace"}', stderr: '' })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb ls returned an unexpected JSON shape (expected a top-level array)',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('returns blocked with the create stderr when the microVM cannot be created', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      throw new Error('Command failed with code 1: no KVM acceleration available')
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })
    expect(logger.error).toHaveBeenCalled()
  })

  it('returns blocked for a directory outside the mounted project roots', async () => {
    enableEnforcement()

    const plan = await service.planShell('/etc')

    expect(plan).toEqual({
      mode: 'blocked',
      reason: `working directory is outside the sandboxed project roots (${reposRoot}, ${worktreesRoot})`,
    })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('removes and recreates a same-name sandbox whose default user does not match the resolved exec identity', async () => {
    enableEnforcement()
    const rootUserRuntime = { ...(realInspectConfig().runtime as Record<string, unknown>), user: null }
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ runtime: rootUserRuntime })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sandbox user null does not match'))
  })

  it('removes and recreates a running sandbox whose bind mount policy differs from the canonical spec', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(
            realInspectConfig({
              mounts: [
                { ...bindMount(reposRoot), options: { readonly: false, noexec: true, nosuid: false, nodev: false } },
                bindMount(worktreesRoot),
                bindMount(toolOutputRoot),
                bindMount(skillsRoot),
                bindMount(agentTmpRoot),
              ],
            }),
          ),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match the canonical specification'))
  })

  it('removes and recreates a running sandbox whose runtime command differs from the canonical spec', async () => {
    enableEnforcement()
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ runtime: { ...runtime, cmd: ['/bin/sh'] } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('runtime.cmd'))
  })

  it('removes and recreates a running sandbox inheriting the image OCI entrypoint instead of /usr/bin/env', async () => {
    enableEnforcement()
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ runtime: { ...runtime, entrypoint: ['docker-entrypoint.sh'] } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('runtime.entrypoint'))
  })

  it('removes and recreates a running sandbox carrying image patches', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ patches: [{ type: 'env', key: 'PATH', value: '/evil' }] })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('patches'))
  })

  it('removes and recreates a running sandbox exposing extra network ports', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ network: { enabled: true, ports: [{ guest: 80 }] } })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network.ports'))
  })

  it('removes and recreates a running sandbox whose lifecycle differs from the canonical spec', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(
            realInspectConfig({ lifecycle: { ephemeral: true, max_duration_secs: null, idle_timeout_secs: null } }),
          ),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('lifecycle.ephemeral'))
  })

  it('reuses a running sandbox carrying image-resolved environment variables', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig({ env: [{ key: 'PATH', value: '/evil' }] })), stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('removes and recreates a running sandbox with a non-default security profile', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ security_profile: 'none' })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('security_profile'))
  })

  it('removes and recreates a running sandbox whose manifest digest is malformed', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ manifest_digest: 42 })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('manifest digest'))
  })

  it('stops the workspace sandbox on shutdown even when capability is unavailable', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    await stopWorkspaceSandboxOnShutdown(db)

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'stop', '--label', 'ocm.managed=true'],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
  })

  it('does not return host mode for an enforced request when the preference is disabled', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const plan = await service.planShell(repoADir, true)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
  })

  it('blocks an enforced request when the capability is unavailable instead of falling back to host', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })

    const plan = await service.planShell(repoADir, true)

    expect(plan).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available' })
    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })

  it('blocks an enforced request when process identity cannot be attested', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    forceProcessAttestation(false)

    try {
      const plan = await service.planShell(repoADir, true)

      expect(plan).toEqual({
        mode: 'blocked',
        reason: 'process identity attestation is unavailable on this platform (Linux /proc is required)',
      })
      expect(mockExecuteCommand).not.toHaveBeenCalled()
    } finally {
      forceProcessAttestation(null)
    }
  })

  it('uses a directory created after boot without recreating the sandbox', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    await service.planShell(repoADir)

    const lateDir = path.join(getScheduleWorktreesPath(), 'job-9-run-9')
    mkdirSync(lateDir, { recursive: true })
    try {
      const plan = await service.planShell(lateDir)

      expect(plan).toEqual({ mode: 'sandbox', workdir: lateDir })
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(0)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    } finally {
      rmSync(lateDir, { recursive: true, force: true })
    }
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

  it('fails closed when the capability becomes unavailable after the toggle was enabled', async () => {
    settingsService.updateSettings({ sandbox: { enabled: true } })
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.6.15' })
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return { exitCode: 0, stdout: runningInspectOutput(realInspectConfig()), stderr: '' }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const first = await service.planShell(repoADir)
    expect(first).toEqual({ mode: 'sandbox', workdir: repoADir })

    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available or not writable' })

    const second = await service.planShell(repoADir)

    expect(second).toEqual({ mode: 'blocked', reason: '/dev/kvm is not available or not writable' })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
  })

  it('stops the managed sandbox using the label filter', async () => {
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    await service.stopWorkspaceSandbox()

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'stop', '--label', 'ocm.managed=true'],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
  })

  it('stops the workspace sandbox on shutdown even when the preference is disabled', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: true, msbVersion: 'msb 0.3.1' })
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    await stopWorkspaceSandboxOnShutdown(db)

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'stop', '--label', 'ocm.managed=true'],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
  })

  it('serializes shutdown with an in-flight boot and stops only after the boot completes', async () => {
    enableEnforcement()
    let releaseInspect: () => void = () => {}
    const inspectGate = new Promise<void>((resolve) => {
      releaseInspect = resolve
    })
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) {
        await inspectGate
        return inspectedRunningSandbox()
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const planning = service.planShell(repoADir)
    await vi.waitFor(() => {
      expect(mockExecuteCommand.mock.calls.some((call) => call[0].includes('inspect'))).toBe(true)
    })

    const stopping = service.stopWorkspaceSandbox()
    releaseInspect()
    const plan = await planning
    await stopping

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    const calls = mockExecuteCommand.mock.calls
    const inspectIndex = calls.findIndex((call) => call[0].includes('inspect'))
    const stopIndex = calls.findIndex((call) => call[0].includes('stop'))
    expect(inspectIndex).toBeGreaterThanOrEqual(0)
    expect(stopIndex).toBeGreaterThan(inspectIndex)
  })

  it('refuses to boot the workspace sandbox once shutdown is in progress', async () => {
    enableEnforcement()
    let releaseStop: () => void = () => {}
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('stop')) {
        await stopGate
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    const stopping = service.stopWorkspaceSandbox()
    await vi.waitFor(() => {
      expect(mockExecuteCommand.mock.calls.some((call) => call[0].includes('stop'))).toBe(true)
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('shutdown is in progress') })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    releaseStop()
    await stopping
  })

  it('aborts an in-flight plan whose pre-boot phase overlaps shutdown and never boots after the stop', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return inspectedRunningSandbox()
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const planning = service.planShell(repoADir)
    const stopping = service.stopWorkspaceSandbox()

    const plan = await planning
    await stopping

    expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('shutdown is in progress') })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('start'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('stop'))).toHaveLength(1)
  })

  it('logs a warning but succeeds when a non-zero stop exit is confirmed stopped', async () => {
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'vm already stopped' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: stoppedListingOutput(), stderr: '' })

    await service.stopWorkspaceSandbox()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('msb stop failed with code 1'))
  })

  it('throws when the shutdown stop fails and the workspace sandbox is still running', async () => {
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'failed to stop vm' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
        stderr: '',
      })

    await expect(service.stopWorkspaceSandbox()).rejects.toThrow('still running')
    expect(logger.error).toHaveBeenCalled()
  })

  it('throws when the shutdown stop fails and the sandbox state cannot be inspected', async () => {
    mockExecuteCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'failed to stop vm' })

    await expect(service.stopWorkspaceSandbox()).rejects.toThrow('msb ls failed with code 1')
    expect(logger.error).toHaveBeenCalled()
  })

  it('stops the managed sandbox on a toggle without refusing later boots', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('stop')) return { exitCode: 0, stdout: '', stderr: '' }
      if (args.includes('inspect')) return inspectedRunningSandbox()
      return { exitCode: 0, stdout: '[]', stderr: '' }
    })

    await service.stopWorkspaceSandboxForToggle()

    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('stop'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
  })

  it('shares one in-flight attempt when exec user provisioning is requested concurrently', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('inspect')) return inspectedRunningSandbox()
      if (args.includes('ls')) return { exitCode: 0, stdout: '[]', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const first = provisionSandboxExecUserForTests()
    const second = provisionSandboxExecUserForTests()

    expect(second).toBe(first)
    await Promise.all([first, second])

    const provisionCalls = mockExecuteCommand.mock.calls.filter(
      (call) => call[0].includes('exec') && call[0].some((arg: string) => arg.includes('/etc/passwd')),
    )
    expect(provisionCalls).toHaveLength(1)
  })

  it('cancels a scheduled provisioning retry when the sandbox is stopped by a toggle', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('exec')) throw new Error('Command timed out after 30000ms')
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) return { exitCode: 1, stdout: '', stderr: 'no such sandbox' }
        return inspectedRunningSandbox()
      }
      if (args.includes('ls')) return { exitCode: 0, stdout: '[]', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    await service.planShell(repoADir)
    const retry = backgroundProvisionRetryForTests()
    expect(retry).not.toBeNull()

    await service.stopWorkspaceSandboxForToggle()
    expect(backgroundProvisionRetryForTests()).toBeNull()

    await retry
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('background retry cancelled'))
  }, 30000)

  it('attempts the toggle stop even when sandbox capability is unavailable', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })
    mockExecuteCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

    await service.stopWorkspaceSandboxForToggle()

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      [sandboxExecutablePath(), 'stop', '--label', 'ocm.managed=true'],
      expect.objectContaining({ ignoreExitCode: true, timeout: expect.any(Number) }),
    )
  })

  it('aborts the toggle-off when the sandbox cannot be proven stopped despite unavailable capability', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: '/dev/kvm is not available' })
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'failed to stop vm' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
        stderr: '',
      })

    await expect(service.stopWorkspaceSandboxForToggle()).rejects.toThrow('still running')
    expect(logger.error).toHaveBeenCalled()
  })

  it('aborts the toggle-off when msb is unavailable and the sandbox state cannot be proven', async () => {
    mockDetectSandboxCapability.mockReturnValue({ available: false, reason: 'msb CLI not found or not executable' })
    mockExecuteCommand.mockRejectedValue(new Error('spawn msb ENOENT'))

    await expect(service.stopWorkspaceSandboxForToggle()).rejects.toThrow('spawn msb ENOENT')
  })

  it('blocks planning when a mount root is a symlink to another directory', async () => {
    enableEnforcement()
    const target = mkdtempSync(path.join(tmpdir(), 'ocm-symlink-target-'))
    mkdirSync(path.join(target, 'repo-a'), { recursive: true })
    rmSync(reposRoot, { recursive: true, force: true })
    try {
      symlinkSync(target, reposRoot)

      const plan = await service.planShell(repoADir)

      expect(plan).toEqual({
        mode: 'blocked',
        reason: expect.stringContaining('symbolic link'),
      })
      expect(mockExecuteCommand).not.toHaveBeenCalled()
    } finally {
      rmSync(reposRoot, { recursive: true, force: true })
      rmSync(target, { recursive: true, force: true })
      mkdirSync(repoADir, { recursive: true })
    }
  })

  it('removes and recreates a same-name sandbox whose mounts duplicate an allowed root and omit a required root', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return attestedAfterRecreate({
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({
            mounts: [
              bindMount(reposRoot),
              bindMount(reposRoot),
            ],
          })),
          stderr: '',
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing one of the project bind mounts'))
  })

  it('re-uses a create failure to invalidate the running cache', async () => {
    enableEnforcement()
    mockExecuteCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' })
      .mockRejectedValueOnce(new Error('Command failed with code 1: no KVM acceleration available'))
      .mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce(inspectedRunningSandbox())

    const failed = await service.planShell(repoADir)
    expect(failed).toEqual({ mode: 'blocked', reason: 'Command failed with code 1: no KVM acceleration available' })

    const retried = await service.planShell(repoADir)
    expect(retried).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('ls'))).toHaveLength(2)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(2)
  })

  it('blocks planning when the sandbox removal fails and never runs a create', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        return {
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ labels: {} })),
          stderr: '',
        }
      }
      if (args.includes('rm')) {
        return { exitCode: 1, stdout: '', stderr: 'failed to kill vm: operation not permitted' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({
      mode: 'blocked',
      reason: 'msb rm failed with code 1: failed to kill vm: operation not permitted',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Recreating unverifiable sandbox'))

    const retried = await service.planShell(repoADir)
    expect(retried).toEqual({
      mode: 'blocked',
      reason: 'msb rm failed with code 1: failed to kill vm: operation not permitted',
    })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(0)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(2)
  })

  it('attests the recreated sandbox before planning sandbox mode', async () => {
    enableEnforcement()
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
          stderr: '',
        }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return {
            exitCode: 0,
            stdout: runningInspectOutput(realInspectConfig({ labels: {} })),
            stderr: '',
          }
        }
        return inspectedRunningSandbox()
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(2)
  })

  it('blocks planning when the freshly created sandbox fails attestation', async () => {
    enableEnforcement()
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      if (args.includes('inspect')) {
        return {
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ labels: {} })),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'blocked', reason: expect.stringContaining('failed attestation') })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(2)

    const retried = await service.planShell(repoADir)
    expect(retried).toEqual({ mode: 'blocked', reason: expect.stringContaining('failed attestation') })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(2)
  })

  it('trusts a freshly created sandbox whose runtime entrypoint is the explicit /usr/bin/env value', async () => {
    enableEnforcement()
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    let inspectCalls = 0
    mockExecuteCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) {
        return { exitCode: 0, stdout: '[]', stderr: '' }
      }
      if (args.includes('inspect')) {
        inspectCalls += 1
        if (inspectCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: 'sandbox not found' }
        }
        return {
          exitCode: 0,
          stdout: runningInspectOutput(realInspectConfig({ runtime: { ...runtime, entrypoint: ['/usr/bin/env'] } })),
          stderr: '',
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const plan = await service.planShell(repoADir)

    expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
    expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('inspect'))).toHaveLength(2)
  })

  function assertRecreateForInspectMutation(
    mutatedConfig: Record<string, unknown>,
    expectedReasonPart: string,
  ): Promise<void> {
    return (async () => {
      enableEnforcement()
      mockExecuteCommand.mockImplementation(async (args: string[]) => {
        if (args.includes('ls')) {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ name: WORKSPACE_SANDBOX_NAME, status: 'running' }]),
            stderr: '',
          }
        }
        if (args.includes('inspect')) {
          return attestedAfterRecreate({
            exitCode: 0,
            stdout: runningInspectOutput(mutatedConfig),
            stderr: '',
          })
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const plan = await service.planShell(repoADir)

      expect(plan).toEqual({ mode: 'sandbox', workdir: repoADir })
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('rm'))).toHaveLength(1)
      expect(mockExecuteCommand.mock.calls.filter((call) => call[0].includes('run'))).toHaveLength(1)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(expectedReasonPart))
    })()
  }

  function assertRecreateForTmpfsOption(
    mountOverrides: Record<string, unknown>,
    expectedReasonPart: string,
  ): Promise<void> {
    return assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
          { type: 'Tmpfs', guest: '/tmp', size_mib: runtimeTmpfsSizeMib(), ...mountOverrides },
        ],
      }),
      expectedReasonPart,
    )
  }

  it('removes and recreates a sandbox whose bind mount follows root symlinks', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          { ...bindMount(reposRoot), follow_root_symlinks: true },
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
        ],
      }),
      'follow_root_symlinks',
    )
  })

  it('removes and recreates a sandbox whose bind mount grants host permissions', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          { ...bindMount(reposRoot), host_permissions: 'public' },
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
        ],
      }),
      'host_permissions',
    )
  })

  it('removes and recreates a sandbox whose bind mount relaxes stat virtualization', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          { ...bindMount(reposRoot), stat_virtualization: 'none' },
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
        ],
      }),
      'stat_virtualization',
    )
  })

  it('removes and recreates a sandbox whose bind mount applies a quota', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          { ...bindMount(reposRoot), quota_mib: 512 },
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
        ],
      }),
      'quota_mib',
    )
  })

  it('removes and recreates a sandbox whose maximum cpus differ from the canonical spec', async () => {
    const resources = realInspectConfig().resources as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ resources: { ...resources, max_cpus: ENV.SANDBOX.CPUS + 2 } }),
      'max cpus',
    )
  })

  it('removes and recreates a sandbox whose maximum memory differs from the canonical spec', async () => {
    const resources = realInspectConfig().resources as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ resources: { ...resources, max_memory_mib: memoryMib() * 2 } }),
      'max memory',
    )
  })

  it('removes and recreates a sandbox whose runtime shell differs from the canonical spec', async () => {
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ runtime: { ...runtime, shell: '/bin/bash' } }),
      'runtime.shell',
    )
  })

  it('removes and recreates a sandbox whose runtime scripts are not empty', async () => {
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ runtime: { ...runtime, scripts: { setup: 'echo hi' } } }),
      'runtime.scripts',
    )
  })

  it('removes and recreates a sandbox whose runtime hostname differs from the canonical spec', async () => {
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ runtime: { ...runtime, hostname: 'evil-host' } }),
      'runtime.hostname',
    )
  })

  it('removes and recreates a sandbox whose runtime samples metrics', async () => {
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ runtime: { ...runtime, metrics_sample_interval_ms: 5000 } }),
      'runtime.metrics_sample_interval_ms',
    )
  })

  it('removes and recreates a sandbox whose runtime enables metrics sampling', async () => {
    const runtime = realInspectConfig().runtime as Record<string, unknown>
    await assertRecreateForInspectMutation(
      realInspectConfig({ runtime: { ...runtime, disable_metrics_sample: true } }),
      'runtime.disable_metrics_sample',
    )
  })

  it('removes and recreates a sandbox whose lifecycle sets a maximum duration', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({ lifecycle: { ephemeral: false, max_duration_secs: 3600, idle_timeout_secs: null } }),
      'lifecycle.max_duration_secs',
    )
  })

  it('removes and recreates a sandbox whose lifecycle sets an idle timeout', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({ lifecycle: { ephemeral: false, max_duration_secs: null, idle_timeout_secs: 60 } }),
      'lifecycle.idle_timeout_secs',
    )
  })

  it('removes and recreates a sandbox missing the runtime tmpfs at /tmp', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
        ],
      }),
      'missing the runtime tmpfs mount at /tmp',
    )
  })

  it('removes and recreates a sandbox duplicating the runtime tmpfs at /tmp', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
          tmpfsMount('/tmp', runtimeTmpfsSizeMib()),
          tmpfsMount('/tmp', runtimeTmpfsSizeMib()),
        ],
      }),
      'duplicate runtime tmpfs',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp has the wrong size', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
          tmpfsMount('/tmp', runtimeTmpfsSizeMib() + 1),
        ],
      }),
      'size_mib',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp is read-only', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
          { type: 'Tmpfs', guest: '/tmp', size_mib: runtimeTmpfsSizeMib(), options: { readonly: true, noexec: false, nosuid: false, nodev: false } },
        ],
      }),
      'options.readonly',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp omits the options field', async () => {
    await assertRecreateForTmpfsOption({}, 'options.')
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp options are not an object', async () => {
    await assertRecreateForTmpfsOption({ options: 'malformed' }, 'options.')
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp has a string option flag', async () => {
    await assertRecreateForTmpfsOption(
      { options: { readonly: 'false', noexec: false, nosuid: false, nodev: false } },
      'options.',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp has a null option flag', async () => {
    await assertRecreateForTmpfsOption(
      { options: { readonly: null, noexec: false, nosuid: false, nodev: false } },
      'options.',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp is noexec', async () => {
    await assertRecreateForTmpfsOption(
      { options: { readonly: false, noexec: true, nosuid: false, nodev: false } },
      'options.noexec',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp is nosuid', async () => {
    await assertRecreateForTmpfsOption(
      { options: { readonly: false, noexec: false, nosuid: true, nodev: false } },
      'options.nosuid',
    )
  })

  it('removes and recreates a sandbox whose runtime tmpfs at /tmp is nodev', async () => {
    await assertRecreateForTmpfsOption(
      { options: { readonly: false, noexec: false, nosuid: false, nodev: true } },
      'options.nodev',
    )
  })

  it('removes and recreates a sandbox carrying an unexpected tmpfs elsewhere', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
          tmpfsMount('/dev/shm', 64),
          tmpfsMount('/tmp', runtimeTmpfsSizeMib()),
        ],
      }),
      'unexpected tmpfs mount',
    )
  })

  it('removes and recreates a sandbox carrying a tmpfs over the assistant .opencode directory', async () => {
    await assertRecreateForInspectMutation(
      realInspectConfig({
        mounts: [
          bindMount(reposRoot),
          bindMount(worktreesRoot),
          bindMount(toolOutputRoot),
          bindMount(skillsRoot),
          bindMount(agentTmpRoot),
          tmpfsMount(getAssistantOpenCodeDir(), null),
          tmpfsMount('/tmp', runtimeTmpfsSizeMib()),
        ],
      }),
      'unexpected tmpfs mount',
    )
  })
})
