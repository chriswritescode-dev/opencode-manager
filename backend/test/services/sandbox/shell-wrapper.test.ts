import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  SANDBOX_SHELL_FILENAME,
  getSandboxShellDir,
  getSandboxShellPath,
  getEnforcedSandboxShellPath,
  installSandboxShell,
} from '../../../src/services/sandbox/shell-wrapper'
import { SANDBOX_UNAVAILABLE_PREFIX } from '../../../src/services/sandbox/command'

const FORBIDDEN_SHELL_BASENAMES = ['bash', 'zsh', 'sh', 'dash', 'ksh', 'fish', 'nu', 'pwsh', 'powershell', 'cmd']

describe('sandbox shell wrapper', () => {
  let configHome: string

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-shell-wrapper-'))
  })

  afterEach(async () => {
    await fs.rm(configHome, { recursive: true, force: true })
  })

  it('derives the sandbox shell directory from the config home', () => {
    expect(getSandboxShellDir(configHome)).toBe(path.join(configHome, 'ocm'))
  })

  it('derives the sandbox shell path from the config home', () => {
    expect(getSandboxShellPath(configHome)).toBe(path.join(configHome, 'ocm', SANDBOX_SHELL_FILENAME))
  })

  it('derives the enforced sandbox shell path from the workspace config home', () => {
    expect(getEnforcedSandboxShellPath()).toBe(path.join(getWorkspacePath(), '.config', 'ocm', SANDBOX_SHELL_FILENAME))
  })

  it('uses a sandbox shell basename outside the rc-file sourcing basenames so OpenCode never injects shell config', () => {
    expect(FORBIDDEN_SHELL_BASENAMES).not.toContain(SANDBOX_SHELL_FILENAME)
  })

  it('installs an executable wrapper whose first line is a shebang targeting the runtime binary', async () => {
    await installSandboxShell(configHome)

    const wrapperPath = getSandboxShellPath(configHome)
    const stat = await fs.stat(wrapperPath)
    expect(stat.mode & 0o777).toBe(0o700)

    const source = await fs.readFile(wrapperPath, 'utf-8')
    const firstLine = source.split('\n')[0]!
    expect(firstLine.startsWith('#!')).toBe(true)
    expect(firstLine).toContain(process.execPath)
  })

  it('writes a wrapper that plans commands through the internal sandbox endpoint with the enforcement token', async () => {
    await installSandboxShell(configHome)

    const source = await fs.readFile(getSandboxShellPath(configHome), 'utf-8')
    expect(source).toContain('/sandbox/command')
    expect(source).toContain('OCM_INTERNAL_TOKEN')
    expect(source).toContain(SANDBOX_UNAVAILABLE_PREFIX)
  })

  it('fail-closes to stderr with exit 1 when the sandbox is unavailable', async () => {
    await installSandboxShell(configHome)

    const result = spawnSync(getSandboxShellPath(configHome), [], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(SANDBOX_UNAVAILABLE_PREFIX)
    expect(result.stderr).toContain('interactive shell sessions are not available while sandbox enforcement is on')
  })
})
