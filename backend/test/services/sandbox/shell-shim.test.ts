import { describe, expect, it, vi, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { WORKSPACE_SANDBOX_NAME } from '../../../src/services/sandbox/command'
import {
  SANDBOX_FORWARDED_ENV_NAMES,
  SANDBOX_SHELL_ENV_HOST_SHELL,
  SANDBOX_SHELL_ENV_WORKDIR,
} from '../../../src/services/sandbox/shell-shim'

afterEach(() => {
  vi.restoreAllMocks()
})

function writeArgvCapturingFakeMsb(msbPath: string, captureFile: string): void {
  writeFileSync(
    msbPath,
    [
      '#!/bin/sh',
      `printf '%s\\0' "$0" "$@" > "${captureFile}"`,
      'payload=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "-c" ]; then payload="$arg"; fi',
      '  prev="$arg"',
      'done',
      'sh -c "$payload"',
    ].join('\n'),
    { mode: 0o755 },
  )
}

describe('sandbox shell shim', () => {
  it('execs msb through the shim with the working directory and a byte-for-byte guest payload', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-shim-msb-'))
    const configHome = mkdtempSync(path.join(tmpdir(), 'ocm-shim-config-'))
    const msbPath = path.join(fakeBin, 'msb')
    const captureFile = path.join(fakeBin, 'argv.txt')
    writeArgvCapturingFakeMsb(msbPath, captureFile)
    const originalMsbPath = process.env.MSB_PATH
    process.env.MSB_PATH = msbPath
    try {
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')
      const commandMod = await import('../../../src/services/sandbox/command')
      commandMod.overrideSandboxExecutableTrustValidator(() => true)
      const { ENV } = await import('@opencode-manager/shared/config/env')
      const shimPath = await shimMod.ensureSandboxShellShim(configHome)

      const directory = path.join(getReposPath(), 'foo')
      const command = 'echo "it\'s a test" && echo line2 | tr a-z A-Z\necho after-newline'
      const result = spawnSync(shimPath, ['-c', command], {
        encoding: 'utf8',
        env: { ...process.env, [SANDBOX_SHELL_ENV_WORKDIR]: directory },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("it's a test\nLINE2\nafter-newline\n")

      const argv = readFileSync(captureFile, 'utf8').split('\0').filter((element) => element !== '')
      expect(argv).toEqual([
        msbPath,
        'exec',
        WORKSPACE_SANDBOX_NAME,
        '--no-tty',
        '-q',
        '-u',
        commandMod.resolveSandboxExecUser(),
        '-w',
        directory,
        '--timeout',
        `${Math.floor(ENV.SANDBOX.EXEC_TIMEOUT_MS / 1000)}s`,
        '--',
        'sh',
        '-c',
        command,
      ])
    } finally {
      if (originalMsbPath === undefined) {
        delete process.env.MSB_PATH
      } else {
        process.env.MSB_PATH = originalMsbPath
      }
      rmSync(fakeBin, { recursive: true, force: true })
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('forwards only the allow-listed credential env into the guest as -e pairs, ahead of the command', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-shim-msb-'))
    const configHome = mkdtempSync(path.join(tmpdir(), 'ocm-shim-config-'))
    const msbPath = path.join(fakeBin, 'msb')
    const captureFile = path.join(fakeBin, 'argv.txt')
    writeArgvCapturingFakeMsb(msbPath, captureFile)
    const originalMsbPath = process.env.MSB_PATH
    process.env.MSB_PATH = msbPath
    try {
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')
      const commandMod = await import('../../../src/services/sandbox/command')
      commandMod.overrideSandboxExecutableTrustValidator(() => true)
      const shimPath = await shimMod.ensureSandboxShellShim(configHome)

      const directory = path.join(getReposPath(), 'foo')
      const extraheaderValue = 'AUTHORIZATION: basic eDphYmMgZGVm'
      const result = spawnSync(shimPath, ['-c', 'echo -e sentinel'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          [SANDBOX_SHELL_ENV_WORKDIR]: directory,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: extraheaderValue,
          OCM_INTERNAL_TOKEN: 'must-not-be-forwarded',
        },
      })
      expect(result.status).toBe(0)

      const argv = readFileSync(captureFile, 'utf8').split('\0').filter((element) => element !== '')

      expect(argv).toContain('-e')
      expect(argv).toContain('GIT_CONFIG_COUNT=1')
      expect(argv).toContain(`GIT_CONFIG_VALUE_0=${extraheaderValue}`)

      const separatorIndex = argv.indexOf('--')
      expect(argv.slice(separatorIndex)).toEqual(['--', 'sh', '-c', 'echo -e sentinel'])
      expect(argv.slice(0, separatorIndex).filter((element) => element === '-e')).toHaveLength(3)

      expect(argv.some((element) => element.startsWith('OCM_INTERNAL_TOKEN='))).toBe(false)
      for (const element of argv) {
        if (!element.includes('=') || element === '--') continue
        const name = element.slice(0, element.indexOf('='))
        if (!SANDBOX_FORWARDED_ENV_NAMES.includes(name as never)) continue
        expect(SANDBOX_FORWARDED_ENV_NAMES).toContain(name)
      }
    } finally {
      if (originalMsbPath === undefined) {
        delete process.env.MSB_PATH
      } else {
        process.env.MSB_PATH = originalMsbPath
      }
      rmSync(fakeBin, { recursive: true, force: true })
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('passes MSB_PATH and the resolved exec identity to msb as single literal arguments', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-shim-hostile-'))
    const configHome = mkdtempSync(path.join(tmpdir(), 'ocm-shim-config-'))
    const captureFile = path.join(fakeBin, 'argv.txt')
    const msbPath = path.join(fakeBin, 'my msb')
    const hostileUser = 'node; echo hacked'
    writeArgvCapturingFakeMsb(msbPath, captureFile)
    const originalMsbPath = process.env.MSB_PATH
    const originalExecUser = process.env.SANDBOX_EXEC_USER
    process.env.MSB_PATH = msbPath
    process.env.SANDBOX_EXEC_USER = hostileUser
    try {
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')
      const commandMod = await import('../../../src/services/sandbox/command')
      commandMod.overrideSandboxExecutableTrustValidator(() => true)
      const shimPath = await shimMod.ensureSandboxShellShim(configHome)

      const directory = path.join(getReposPath(), 'foo')
      const command = 'echo hostile-ok'
      const result = spawnSync(shimPath, ['-c', command], {
        encoding: 'utf8',
        env: { ...process.env, [SANDBOX_SHELL_ENV_WORKDIR]: directory },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('hostile-ok\n')

      const resolvedUser = commandMod.resolveSandboxExecUser()
      expect(resolvedUser).toMatch(/^\d+:\d+$/)

      const argv = readFileSync(captureFile, 'utf8').split('\0').filter((element) => element !== '')
      expect(argv[0]).toBe(msbPath)
      expect(argv[argv.indexOf('-u') + 1]).toBe(resolvedUser)
      expect(argv[argv.indexOf('-w') + 1]).toBe(directory)
      expect(argv[argv.indexOf('-c') + 1]).toBe(command)
      expect(argv.join(' ')).not.toContain(hostileUser)
    } finally {
      if (originalMsbPath === undefined) {
        delete process.env.MSB_PATH
      } else {
        process.env.MSB_PATH = originalMsbPath
      }
      if (originalExecUser === undefined) {
        delete process.env.SANDBOX_EXEC_USER
      } else {
        process.env.SANDBOX_EXEC_USER = originalExecUser
      }
      rmSync(fakeBin, { recursive: true, force: true })
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('passes through to the host shell when the workdir env is unset and never invokes msb', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-shim-passthrough-'))
    const configHome = mkdtempSync(path.join(tmpdir(), 'ocm-shim-config-'))
    const msbCaptureFile = path.join(fakeBin, 'msb-invoked.txt')
    const msbPath = path.join(fakeBin, 'msb')
    writeFileSync(msbPath, ['#!/bin/sh', `printf 'invoked' > "${msbCaptureFile}"`].join('\n'), { mode: 0o755 })
    const originalMsbPath = process.env.MSB_PATH
    process.env.MSB_PATH = msbPath
    try {
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')
      const commandMod = await import('../../../src/services/sandbox/command')
      commandMod.overrideSandboxExecutableTrustValidator(() => true)
      const shimPath = await shimMod.ensureSandboxShellShim(configHome)

      const env: Record<string, string | undefined> = { ...process.env }
      delete env[SANDBOX_SHELL_ENV_WORKDIR]
      delete env[SANDBOX_SHELL_ENV_HOST_SHELL]
      const result = spawnSync(shimPath, ['-c', 'echo passthrough-ok'], { encoding: 'utf8', env })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('passthrough-ok\n')
      expect(existsSync(msbCaptureFile)).toBe(false)
    } finally {
      if (originalMsbPath === undefined) {
        delete process.env.MSB_PATH
      } else {
        process.env.MSB_PATH = originalMsbPath
      }
      rmSync(fakeBin, { recursive: true, force: true })
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('lets OCM_SANDBOX_HOST_SHELL override the baked default host shell in the passthrough branch', async () => {
    const fakeBin = mkdtempSync(path.join(tmpdir(), 'ocm-shim-hostshell-'))
    const configHome = mkdtempSync(path.join(tmpdir(), 'ocm-shim-config-'))
    const msbCaptureFile = path.join(fakeBin, 'msb-invoked.txt')
    const msbPath = path.join(fakeBin, 'msb')
    writeFileSync(msbPath, ['#!/bin/sh', `printf 'invoked' > "${msbCaptureFile}"`].join('\n'), { mode: 0o755 })
    const fakeShellPath = path.join(fakeBin, 'custom-host-shell')
    const shellCaptureFile = path.join(fakeBin, 'shell-argv.txt')
    writeFileSync(
      fakeShellPath,
      [
        '#!/bin/sh',
        `printf '%s\\0' "$0" "$@" > "${shellCaptureFile}"`,
        'sh "$@"',
      ].join('\n'),
      { mode: 0o755 },
    )
    const originalMsbPath = process.env.MSB_PATH
    process.env.MSB_PATH = msbPath
    try {
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')
      const commandMod = await import('../../../src/services/sandbox/command')
      commandMod.overrideSandboxExecutableTrustValidator(() => true)
      const shimPath = await shimMod.ensureSandboxShellShim(configHome)

      const env: Record<string, string | undefined> = { ...process.env, [SANDBOX_SHELL_ENV_HOST_SHELL]: fakeShellPath }
      delete env[SANDBOX_SHELL_ENV_WORKDIR]
      const command = 'echo custom-shell-ok'
      const result = spawnSync(shimPath, ['-c', command], { encoding: 'utf8', env })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('custom-shell-ok\n')
      expect(existsSync(msbCaptureFile)).toBe(false)

      const shellArgv = readFileSync(shellCaptureFile, 'utf8').split('\0').filter((element) => element !== '')
      expect(shellArgv[0]).toBe(fakeShellPath)
      expect(shellArgv[shellArgv.indexOf('-c') + 1]).toBe(command)
    } finally {
      if (originalMsbPath === undefined) {
        delete process.env.MSB_PATH
      } else {
        process.env.MSB_PATH = originalMsbPath
      }
      rmSync(fakeBin, { recursive: true, force: true })
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('writes an executable regular shim at sandboxShellShimPath and is idempotent', async () => {
    const configHome = mkdtempSync(path.join(tmpdir(), 'ocm-shim-config-'))
    try {
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')

      const expected = shimMod.sandboxShellShimPath(configHome)
      const first = await shimMod.ensureSandboxShellShim(configHome)
      expect(first).toBe(expected)
      const stat = statSync(expected)
      expect(stat.isFile()).toBe(true)
      expect(stat.mode & 0o100).not.toBe(0)
      const content = readFileSync(expected, 'utf8')
      expect(content).toContain('#!/bin/sh')

      const second = await shimMod.ensureSandboxShellShim(configHome)
      expect(second).toBe(expected)
      expect(readFileSync(expected, 'utf8')).toBe(content)
    } finally {
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('refuses to install the shim when its path falls inside a sandbox mount root', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ocm-shim-guard-'))
    const originalWorkspacePath = process.env.WORKSPACE_PATH
    try {
      const repos = path.join(tmp, 'workspace', 'repos')
      mkdirSync(repos, { recursive: true })

      process.env.WORKSPACE_PATH = path.join(tmp, 'workspace')
      vi.resetModules()
      const shimMod = await import('../../../src/services/sandbox/shell-shim')

      const configHome = path.join(repos, 'config')
      await expect(shimMod.ensureSandboxShellShim(configHome)).rejects.toThrow(
        'refusing to install the sandbox shell shim',
      )
      expect(existsSync(shimMod.sandboxShellShimPath(configHome))).toBe(false)
    } finally {
      if (originalWorkspacePath === undefined) {
        delete process.env.WORKSPACE_PATH
      } else {
        process.env.WORKSPACE_PATH = originalWorkspacePath
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
