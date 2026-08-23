import { describe, expect, it, vi, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ENV, getAssistantOpenCodeDir, getReposPath, getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { unwrapSandboxExecCommand } from '@opencode-manager/shared/utils'
import {
  WORKSPACE_SANDBOX_NAME,
  SANDBOX_UNAVAILABLE_PREFIX,
  buildCanonicalSandboxSpec,
  buildSandboxCreateArgs,
  buildSandboxInspectArgs,
  buildSandboxListArgs,
  buildSandboxRemoveArgs,
  buildSandboxStartArgs,
  buildSandboxStopManagedArgs,
  buildSandboxVersionArgs,
  quoteForShell,
  resolveExpectedSandboxNetworkPolicy,
  resolveSandboxExecUser,
  resolveSandboxExecUserUid,
  resolveSandboxRuntimeTmpfsSizeMib,
  sandboxMountRoots,
  sandboxNetworkPolicyMismatch,
  sandboxSecretMaskPath,
} from '../../../src/services/sandbox/command'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sandbox command builders', () => {
  it('builds the version probe as exactly --version', () => {
    expect(buildSandboxVersionArgs()).toEqual(['--version'])
  })

  it('builds inspect args targeting the shared workspace sandbox with JSON output', () => {
    expect(buildSandboxInspectArgs()).toEqual(['inspect', WORKSPACE_SANDBOX_NAME, '--format', 'json'])
  })

  it('builds remove args that force-remove the shared workspace sandbox', () => {
    expect(buildSandboxRemoveArgs()).toEqual(['rm', '--force', WORKSPACE_SANDBOX_NAME])
  })

  it('builds list args that emit machine-readable JSON for all sandboxes', () => {
    expect(buildSandboxListArgs()).toEqual(['ls', '--format', 'json'])
  })

  it('builds start args targeting the shared workspace sandbox', () => {
    expect(buildSandboxStartArgs()).toEqual(['start', WORKSPACE_SANDBOX_NAME])
  })

  it('builds managed-stop args that filter by the ocm.managed label', () => {
    expect(buildSandboxStopManagedArgs()).toEqual(['stop', '--label', 'ocm.managed=true'])
  })

  it('escapes embedded single quotes so values survive a shell round-trip', () => {
    const value = "echo 'a'b'"
    expect(quoteForShell(value)).toBe(`'echo '\\''a'\\''b'\\'''`)

    const result = spawnSync('sh', ['-c', `printf '%s' ${quoteForShell(value)}`], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(value)
  })

  it('builds create args with exactly two identical-path bind mounts and the detached flag', () => {
    const args = buildSandboxCreateArgs()

    expect(args[0]).toBe('run')
    expect(args).toContain('-d')
    expect(args).toContain('--name')
    expect(args[args.indexOf('--name') + 1]).toBe(WORKSPACE_SANDBOX_NAME)
    expect(args[args.indexOf('-w') + 1]).toBe(getReposPath())
    expect(args[args.indexOf('-u') + 1]).toBe(resolveSandboxExecUser())

    const labelArgs: string[] = []
    for (let i = 0; i < args.length; i++) {
      const value = args[i + 1]
      if (args[i] === '--label' && value !== undefined) {
        labelArgs.push(value)
      }
    }
    expect(labelArgs).toContain('ocm.managed=true')
    expect(labelArgs).toContain(`ocm.net=${ENV.SANDBOX.NET}`)

    const mountArgs: string[] = []
    for (let i = 0; i < args.length; i++) {
      const value = args[i + 1]
      if (args[i] === '--mount-dir' && value !== undefined) {
        mountArgs.push(value)
      }
    }
    expect(mountArgs).toEqual(sandboxMountRoots().map((root) => `${root}:${root}`))
    expect(mountArgs[0]).toBe(`${getReposPath()}:${getReposPath()}`)
    expect(mountArgs[1]).toBe(`${getScheduleWorktreesPath()}:${getScheduleWorktreesPath()}`)
  })

  it('masks the assistant .opencode directory with a tmpfs overlay', () => {
    const args = buildSandboxCreateArgs()

    expect(args[args.indexOf('--tmpfs') + 1]).toBe(getAssistantOpenCodeDir())
    expect(sandboxSecretMaskPath()).toBe(getAssistantOpenCodeDir())
  })

  it('pins --entrypoint to /usr/bin/env before the image so msb never inherits the OCI entrypoint', () => {
    const args = buildSandboxCreateArgs()

    const entrypointIndex = args.indexOf('--entrypoint')
    expect(entrypointIndex).toBeGreaterThan(-1)
    expect(args[entrypointIndex + 1]).toBe('/usr/bin/env')
    expect(args.indexOf(ENV.SANDBOX.IMAGE)).toBeGreaterThan(entrypointIndex + 1)
  })

  it('never mounts the SSH/config/state workspace directories', () => {
    const joined = buildSandboxCreateArgs().join(' ')
    const workspacePath = path.dirname(getReposPath())

    expect(joined).not.toContain(`${workspacePath}/.config`)
    expect(joined).not.toContain(`${workspacePath}/config`)
    expect(joined).not.toContain('auth.json')
    expect(joined).not.toContain(`${workspacePath}/.opencode`)
    expect(joined).not.toContain('/.opencode/state')
  })

  it('derives a canonical spec from the create args matching the security configuration', () => {
    const spec = buildCanonicalSandboxSpec()
    const labels = spec.labels as Record<string, string>
    const resources = spec.resources as Record<string, number>
    const runtime = spec.runtime as Record<string, unknown>
    const mounts = spec.mounts as Array<Record<string, unknown>>
    const network = spec.network as Record<string, unknown>
    const lifecycle = spec.lifecycle as Record<string, unknown>

    expect(spec.name).toBe(WORKSPACE_SANDBOX_NAME)
    const canonicalImage = spec.image as Record<string, { reference: string } | undefined>
    expect(canonicalImage.Oci?.reference).toBe(ENV.SANDBOX.IMAGE)
    expect(labels['ocm.managed']).toBe('true')
    expect(labels['ocm.net']).toBe(ENV.SANDBOX.NET)
    expect(resources.cpus).toBe(ENV.SANDBOX.CPUS)
    expect(typeof resources.memory_mib).toBe('number')
    expect(runtime.workdir).toBe(getReposPath())
    expect(runtime.user).toBe(resolveSandboxExecUser())
    expect(runtime.cmd).toEqual(['sleep', 'infinity'])
    expect(runtime.entrypoint).toEqual(['/usr/bin/env'])
    expect(spec.patches).toEqual([])
    expect(network.enabled).toBe(true)
    expect(network.ports).toEqual([])
    expect(lifecycle.ephemeral).toBe(false)
    expect(lifecycle.max_duration_secs).toBeNull()
    expect(lifecycle.idle_timeout_secs).toBeNull()

    const binds = mounts.filter((mount) => mount.type === 'Bind')
    expect(binds).toHaveLength(2)
    expect(binds.map((mount) => mount.host)).toEqual([getReposPath(), getScheduleWorktreesPath()])
    for (const mount of binds) {
      expect(mount.guest).toBe(mount.host)
      const options = mount.options as Record<string, boolean>
      expect(options.readonly).toBe(false)
      expect(options.noexec).toBe(false)
      expect(options.nosuid).toBe(false)
      expect(options.nodev).toBe(false)
      expect(mount.stat_virtualization).toBe('strict')
      expect(mount.host_permissions).toBe('private')
      expect(mount.follow_root_symlinks).toBe(false)
      expect(mount.quota_mib).toBeNull()
    }

    const tmpfs = mounts.find((mount) => mount.type === 'Tmpfs')
    expect(tmpfs?.guest).toBe(getAssistantOpenCodeDir())
    expect((tmpfs as Record<string, unknown>).size_mib).toBeNull()
  })

  it('accepts real repo dirs and schedule worktrees while rejecting config, missing, and unrelated paths', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ocm-sandbox-roots-'))
    const originalWorkspacePath = process.env.WORKSPACE_PATH
    try {
      const repos = path.join(tmp, 'repos')
      const schedules = path.join(tmp, 'schedule-worktrees')
      mkdirSync(path.join(repos, 'org', 'repo', 'subdir'), { recursive: true })
      mkdirSync(path.join(schedules, 'job-1-run-2'), { recursive: true })
      mkdirSync(path.join(tmp, '.config', 'opencode'), { recursive: true })

      process.env.WORKSPACE_PATH = tmp
      const { resolveSandboxWorkDirectory } = await import('../../../src/services/sandbox/command')

      await expect(resolveSandboxWorkDirectory(repos)).resolves.toBe(repos)
      await expect(resolveSandboxWorkDirectory(path.join(repos, 'org', 'repo', 'subdir'))).resolves.toBe(
        path.join(repos, 'org', 'repo', 'subdir'),
      )
      await expect(resolveSandboxWorkDirectory(path.join(schedules, 'job-1-run-2'))).resolves.toBe(
        path.join(schedules, 'job-1-run-2'),
      )
      await expect(resolveSandboxWorkDirectory(path.join(repos, '..', '.config', 'opencode'))).resolves.toBeNull()
      await expect(resolveSandboxWorkDirectory(`${repos}-extra`)).resolves.toBeNull()
      await expect(resolveSandboxWorkDirectory(path.join(repos, 'missing'))).resolves.toBeNull()
      await expect(resolveSandboxWorkDirectory('/etc')).resolves.toBeNull()
    } finally {
      if (originalWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = originalWorkspacePath
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns canonical guest paths for symlinks inside the roots and null for escapes', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ocm-sandbox-escape-'))
    const originalWorkspacePath = process.env.WORKSPACE_PATH
    try {
      const repos = path.join(tmp, 'repos')
      const schedules = path.join(tmp, 'schedule-worktrees')
      mkdirSync(path.join(tmp, 'outside'), { recursive: true })
      mkdirSync(path.join(repos, 'repo'), { recursive: true })
      mkdirSync(path.join(repos, 'other-repo'), { recursive: true })
      mkdirSync(path.join(schedules, 'job-1-run-2'), { recursive: true })
      symlinkSync(path.join(tmp, 'outside'), path.join(repos, 'repo', 'escape'))
      symlinkSync(path.join(repos, 'other-repo'), path.join(repos, 'repo', 'inside-link'))
      symlinkSync(path.join(schedules, 'job-1-run-2'), path.join(repos, 'repo', 'cross-root-link'))

      process.env.WORKSPACE_PATH = tmp
      const { resolveSandboxWorkDirectory } = await import('../../../src/services/sandbox/command')

      await expect(resolveSandboxWorkDirectory(path.join(repos, 'repo'))).resolves.toBe(path.join(repos, 'repo'))
      await expect(resolveSandboxWorkDirectory(path.join(repos, 'repo', 'escape'))).resolves.toBeNull()
      await expect(resolveSandboxWorkDirectory(path.join(repos, 'repo', 'escape', 'nested'))).resolves.toBeNull()
      await expect(resolveSandboxWorkDirectory(path.join(repos, 'repo', 'inside-link'))).resolves.toBe(
        path.join(repos, 'other-repo'),
      )
      await expect(resolveSandboxWorkDirectory(path.join(repos, 'repo', 'cross-root-link'))).resolves.toBe(
        path.join(schedules, 'job-1-run-2'),
      )
    } finally {
      if (originalWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = originalWorkspacePath
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('resolves the named exec user default to the manager uid:gid', () => {
    const proc = process as unknown as { getuid: () => number; getgid: () => number }
    vi.spyOn(proc, 'getuid').mockReturnValue(1001)
    vi.spyOn(proc, 'getgid').mockReturnValue(1002)

    expect(resolveSandboxExecUser()).toBe('1001:1002')
    expect(resolveSandboxExecUserUid()).toBe(1001)
  })

  it('aligns a numeric exec user with the manager gid', async () => {
    const proc = process as unknown as { getuid: () => number; getgid: () => number }
    vi.spyOn(proc, 'getuid').mockReturnValue(1001)
    vi.spyOn(proc, 'getgid').mockReturnValue(1002)
    process.env.SANDBOX_EXEC_USER = '1001'
    try {
      vi.resetModules()
      const { resolveSandboxExecUser } = await import('../../../src/services/sandbox/command')
      expect(resolveSandboxExecUser()).toBe('1001:1002')
    } finally {
      delete process.env.SANDBOX_EXEC_USER
    }
  })

  it('keeps an explicit uid:gid exec user verbatim', async () => {
    process.env.SANDBOX_EXEC_USER = '1000:1000'
    try {
      vi.resetModules()
      const { resolveSandboxExecUser } = await import('../../../src/services/sandbox/command')
      expect(resolveSandboxExecUser()).toBe('1000:1000')
    } finally {
      delete process.env.SANDBOX_EXEC_USER
    }
  })

  it('exposes the sandbox-unavailable message prefix', () => {
    expect(SANDBOX_UNAVAILABLE_PREFIX).toBe('Sandbox enforcement is on but the sandbox is unavailable: ')
  })

  it('resolves a relative MSB_PATH to one absolute executable found on PATH', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-msb-resolve-'))
    writeFileSync(path.join(fakeBin, 'msb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const originalPath = process.env.PATH
    process.env.PATH = fakeBin
    try {
      vi.resetModules()
      const mod = await import('../../../src/services/sandbox/command')
      mod.overrideSandboxExecutableTrustValidator(() => true)
      const { resolveSandboxExecutable, sandboxExecutablePath } = mod

      expect(resolveSandboxExecutable()).toBe(path.join(fakeBin, 'msb'))
      expect(sandboxExecutablePath()).toBe(path.join(fakeBin, 'msb'))
    } finally {
      process.env.PATH = originalPath
      rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('returns null when a relative MSB_PATH has no executable candidate on PATH', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/nonexistent-ocm-bin'
    try {
      vi.resetModules()
      const { resolveSandboxExecutable, sandboxExecutablePath } = await import('../../../src/services/sandbox/command')

      expect(resolveSandboxExecutable()).toBeNull()
      expect(sandboxExecutablePath()).toBe(ENV.SANDBOX.MSB_PATH)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('returns an absolute MSB_PATH verbatim without consulting PATH', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-msb-abs-'))
    const msbPath = path.join(fakeBin, 'my msb')
    writeFileSync(msbPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    process.env.MSB_PATH = msbPath
    try {
      vi.resetModules()
      const mod = await import('../../../src/services/sandbox/command')
      mod.overrideSandboxExecutableTrustValidator(() => true)
      const { resolveSandboxExecutable, sandboxExecutablePath } = mod

      expect(resolveSandboxExecutable()).toBe(msbPath)
      expect(sandboxExecutablePath()).toBe(msbPath)
    } finally {
      delete process.env.MSB_PATH
      rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('rejects an msb executable located inside a mounted project root', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ocm-msb-mount-'))
    const originalWorkspacePath = process.env.WORKSPACE_PATH
    const originalPath = process.env.PATH
    try {
      const repos = path.join(tmp, 'workspace', 'repos')
      mkdirSync(path.join(repos, 'bin'), { recursive: true })
      writeFileSync(path.join(repos, 'bin', 'msb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

      process.env.WORKSPACE_PATH = path.join(tmp, 'workspace')
      process.env.PATH = path.join(repos, 'bin')
      vi.resetModules()
      const { resolveSandboxExecutable, sandboxExecutablePath } = await import('../../../src/services/sandbox/command')

      expect(resolveSandboxExecutable()).toBeNull()
      expect(sandboxExecutablePath()).toBe(ENV.SANDBOX.MSB_PATH)
    } finally {
      if (originalWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = originalWorkspacePath
      }
      process.env.PATH = originalPath
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects an msb executable whose symlink resolves into a mounted project root', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ocm-msb-symlink-'))
    const originalWorkspacePath = process.env.WORKSPACE_PATH
    const originalPath = process.env.PATH
    try {
      const repos = path.join(tmp, 'workspace', 'repos')
      const bin = path.join(tmp, 'bin')
      mkdirSync(path.join(repos, 'evil'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(path.join(repos, 'evil', 'msb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      symlinkSync(path.join(repos, 'evil', 'msb'), path.join(bin, 'msb'))

      process.env.WORKSPACE_PATH = path.join(tmp, 'workspace')
      process.env.PATH = bin
      vi.resetModules()
      const { resolveSandboxExecutable, sandboxExecutablePath } = await import('../../../src/services/sandbox/command')

      expect(resolveSandboxExecutable()).toBeNull()
      expect(sandboxExecutablePath()).toBe(ENV.SANDBOX.MSB_PATH)
    } finally {
      if (originalWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = originalWorkspacePath
      }
      process.env.PATH = originalPath
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects an msb executable writable by the manager user or a parent directory', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-msb-writable-'))
    writeFileSync(path.join(fakeBin, 'msb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const originalPath = process.env.PATH
    process.env.PATH = fakeBin
    try {
      vi.resetModules()
      const { resolveSandboxExecutable, sandboxExecutablePath } = await import('../../../src/services/sandbox/command')

      expect(resolveSandboxExecutable()).toBeNull()
      expect(sandboxExecutablePath()).toBe(ENV.SANDBOX.MSB_PATH)
    } finally {
      process.env.PATH = originalPath
      rmSync(fakeBin, { recursive: true, force: true })
    }
  })
})

describe('unwrapSandboxExecCommand recovers commands from the legacy recorded wrapper format', () => {
  const legacyWrapped = (directory: string, command: string) =>
    `${quoteForShell('/usr/local/bin/msb')} exec ocm-workspace --no-tty -q -u '1001:1001' -w ${quoteForShell(directory)} --timeout 600s -- sh -c ${quoteForShell(command)}`

  it('recovers the original command from a legacy sandbox exec wrapper', () => {
    const directory = '/workspace/repos/ai-test'
    for (const command of [
      'git status',
      "echo 'hi there'",
      "echo 'x' -- sh -c 'y'",
      'git status\ngit diff\necho done',
    ]) {
      expect(unwrapSandboxExecCommand(legacyWrapped(directory, command))).toBe(command)
    }
  })

  it('passes through plain, blocked, empty, and near-miss commands unchanged', () => {
    const blocked = "printf '%s\n' 'Sandbox enforcement is on but the sandbox is unavailable: KVM is unavailable' >&2; exit 1"
    const nearMiss = legacyWrapped('/workspace/repos/ai-test', 'git status').replace(' --no-tty -q ', ' --no-tty ')

    expect(unwrapSandboxExecCommand('git status')).toBe('git status')
    expect(unwrapSandboxExecCommand(blocked)).toBe(blocked)
    expect(unwrapSandboxExecCommand('')).toBe('')
    expect(unwrapSandboxExecCommand(nearMiss)).toBe(nearMiss)
  })
})

describe('resolveSandboxRuntimeTmpfsSizeMib', () => {
  it('clamps the quarter-memory floor to the 1-512 MiB range', () => {
    expect(resolveSandboxRuntimeTmpfsSizeMib(1)).toBe(1)
    expect(resolveSandboxRuntimeTmpfsSizeMib(3)).toBe(1)
    expect(resolveSandboxRuntimeTmpfsSizeMib(4)).toBe(1)
    expect(resolveSandboxRuntimeTmpfsSizeMib(2047)).toBe(511)
    expect(resolveSandboxRuntimeTmpfsSizeMib(2048)).toBe(512)
    expect(resolveSandboxRuntimeTmpfsSizeMib(2049)).toBe(512)
    expect(resolveSandboxRuntimeTmpfsSizeMib(4096)).toBe(512)
  })

  it('floors fractional positive memory to whole MiB', () => {
    expect(resolveSandboxRuntimeTmpfsSizeMib(5.5)).toBe(1)
    expect(resolveSandboxRuntimeTmpfsSizeMib(10.5)).toBe(2)
    expect(resolveSandboxRuntimeTmpfsSizeMib(0.5)).toBe(1)
  })

  it('rejects zero, negative, non-finite, and non-number memory values', () => {
    expect(resolveSandboxRuntimeTmpfsSizeMib(0)).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib(-1)).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib(Number.NaN)).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib(Number.POSITIVE_INFINITY)).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib(Number.NEGATIVE_INFINITY)).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib('512')).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib(null)).toBeNull()
    expect(resolveSandboxRuntimeTmpfsSizeMib(undefined)).toBeNull()
  })
})

describe('sandbox network policy attestation helpers', () => {
  const publicPolicy = {
    default_egress: 'deny',
    default_ingress: 'allow',
    rules: [
      { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
      { direction: 'egress', destination: { group: 'public' }, protocols: [], ports: [], action: 'allow' },
    ],
  }

  it('resolves the public profile to the deny-by-default fixture policy', () => {
    expect(resolveExpectedSandboxNetworkPolicy('public')).toEqual(publicPolicy)
  })

  it('composes comma-separated profiles with a single DNS rule in profile order', () => {
    expect(resolveExpectedSandboxNetworkPolicy('public,private,host')).toEqual({
      default_egress: 'deny',
      default_ingress: 'allow',
      rules: [
        { direction: 'egress', destination: { group: 'host' }, protocols: ['udp', 'tcp'], ports: [{ start: 53, end: 53 }], action: 'allow' },
        { direction: 'egress', destination: { group: 'public' }, protocols: [], ports: [], action: 'allow' },
        { direction: 'egress', destination: { group: 'private' }, protocols: [], ports: [], action: 'allow' },
        { direction: 'egress', destination: { group: 'host' }, protocols: [], ports: [], action: 'allow' },
      ],
    })
  })

  it('deduplicates repeated profiles', () => {
    expect(resolveExpectedSandboxNetworkPolicy('public, public')).toEqual(publicPolicy)
  })

  it('returns null for terminal, unknown, or empty profiles', () => {
    expect(resolveExpectedSandboxNetworkPolicy('all')).toBeNull()
    expect(resolveExpectedSandboxNetworkPolicy('none')).toBeNull()
    expect(resolveExpectedSandboxNetworkPolicy('public,unknown')).toBeNull()
    expect(resolveExpectedSandboxNetworkPolicy('')).toBeNull()
    expect(resolveExpectedSandboxNetworkPolicy('  ')).toBeNull()
  })

  it('accepts the source-faithful public policy fixture', () => {
    expect(sandboxNetworkPolicyMismatch(publicPolicy, resolveExpectedSandboxNetworkPolicy('public')!)).toBeNull()
  })

  it('rejects a policy with an allow-all wildcard rule', () => {
    const inspected = {
      ...publicPolicy,
      rules: [
        publicPolicy.rules[0],
        { direction: 'egress', destination: { any: true }, protocols: [], ports: [], action: 'allow' },
      ],
    }
    expect(sandboxNetworkPolicyMismatch(inspected, resolveExpectedSandboxNetworkPolicy('public')!)).toContain('network policy')
  })

  it('rejects a policy whose profile rule is broadened to specific protocols and ports', () => {
    const inspected = {
      ...publicPolicy,
      rules: [
        publicPolicy.rules[0],
        { direction: 'egress', destination: { group: 'public' }, protocols: ['tcp'], ports: [443], action: 'allow' },
      ],
    }
    expect(sandboxNetworkPolicyMismatch(inspected, resolveExpectedSandboxNetworkPolicy('public')!)).toContain('network policy')
  })

  it('rejects a policy carrying stale rules from another profile', () => {
    const inspected = {
      ...publicPolicy,
      rules: [
        ...publicPolicy.rules,
        { direction: 'egress', destination: { group: 'private' }, protocols: [], ports: [], action: 'allow' },
      ],
    }
    expect(sandboxNetworkPolicyMismatch(inspected, resolveExpectedSandboxNetworkPolicy('public')!)).toContain('network policy')
  })

  it('rejects a policy missing a required rule', () => {
    const inspected = {
      ...publicPolicy,
      rules: [publicPolicy.rules[0]],
    }
    expect(sandboxNetworkPolicyMismatch(inspected, resolveExpectedSandboxNetworkPolicy('public')!)).toContain('network policy')
  })

  it('rejects an allow egress default with an unrestricted-egress reason', () => {
    const inspected = { default_egress: 'allow', default_ingress: 'allow', rules: [] }
    const mismatch = sandboxNetworkPolicyMismatch(inspected, resolveExpectedSandboxNetworkPolicy('public')!)
    expect(mismatch).toContain('unrestricted egress')
  })

  it('rejects an altered ingress default', () => {
    const inspected = { ...publicPolicy, default_ingress: 'deny' }
    expect(sandboxNetworkPolicyMismatch(inspected, resolveExpectedSandboxNetworkPolicy('public')!)).toContain('default_ingress')
  })

  it('rejects a missing or malformed policy', () => {
    const expected = resolveExpectedSandboxNetworkPolicy('public')!
    expect(sandboxNetworkPolicyMismatch(undefined, expected)).toContain('missing or malformed')
    expect(sandboxNetworkPolicyMismatch({ default_egress: 'deny' }, expected)).toContain('missing or malformed')
    expect(sandboxNetworkPolicyMismatch({ ...publicPolicy, rules: 'not-an-array' }, expected)).toContain('missing or malformed')
    expect(sandboxNetworkPolicyMismatch(
      { ...publicPolicy, rules: [{ direction: 'egress', destination: { group: 'host' }, action: 'allow' }] },
      expected,
    )).toContain('network policy')
  })
})
