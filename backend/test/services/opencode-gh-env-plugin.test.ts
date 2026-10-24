import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { installManagedPlugins, getOpenCodePluginDir } from '../../src/services/opencode/plugin-registry'
import { SANDBOX_SHELL_STATE_KEY } from '../../src/services/opencode-plugin-state'
import {
  loadGeneratedPlugin,
  type GeneratedPlugin,
  type GeneratedTool,
  type GeneratedToolExecuteContext,
  type ShellCreateBeforeEvent,
  type ToolExecuteAfterEvent,
} from '../helpers/opencode-plugin-context'

const INTERNAL_API_URL = 'http://localhost:5003/api/internal'
const MASK_STATE_KEY = Symbol.for('ocm-secret-masks.v1')
const PLAN_NAME = 'ocm-session-0123456789ab'

type MaskState = { byCwd: Map<string, string[]>; version: number; unionVersion: number; union: string[] }

type ShellSandboxState = { inFlightSandboxedCommands: Map<string, number> }

function maskStateForTests(): MaskState | undefined {
  return (globalThis as Record<symbol, unknown>)[MASK_STATE_KEY] as MaskState | undefined
}

function shellSandboxStateForTests(): ShellSandboxState | undefined {
  return (globalThis as Record<symbol, unknown>)[Symbol.for(SANDBOX_SHELL_STATE_KEY)] as ShellSandboxState | undefined
}

function shellTool(plugin: GeneratedPlugin, execute: (input: unknown, context: GeneratedToolExecuteContext) => Promise<unknown>): GeneratedTool {
  const tool = plugin.applyToolTransforms([{ name: 'shell', execute }]).find((candidate) => candidate.name === 'shell')
  if (!tool) throw new Error('the shell tool was not found after transforms')
  return tool
}

function shellCreateEvent(command: string, cwd: string): ShellCreateBeforeEvent {
  return { command, cwd, env: {} }
}

describe('ocm-gh-env plugin', () => {
  let configHome: string

  function pluginPath() {
    return path.join(getOpenCodePluginDir(configHome), 'ocm-gh-env.js')
  }

  function legacyPluginPath() {
    return path.join(configHome, 'opencode', 'plugin', 'ocm-gh-env.js')
  }

  async function loadPlugin() {
    return loadGeneratedPlugin(pluginPath())
  }

  function stubShellEnvFetch(body: { env?: Record<string, string>; mask?: string[] }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-ghenv-'))
    await installManagedPlugins(configHome)
    process.env.OCM_INTERNAL_API_URL = INTERNAL_API_URL
    process.env.OCM_INTERNAL_TOKEN = 'secret-token'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as Record<symbol, unknown>)[MASK_STATE_KEY]
    delete (globalThis as Record<symbol, unknown>)[Symbol.for(SANDBOX_SHELL_STATE_KEY)]
    delete process.env.OCM_SANDBOX_ENFORCED
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    await fs.rm(configHome, { recursive: true, force: true })
  })

  it('writes the plugin file into the V2 auto-discovery dir', async () => {
    const stat = await fs.lstat(pluginPath())

    expect(stat.isFile()).toBe(true)
    expect(stat.isSymbolicLink()).toBe(false)
  })

  it('default-exports the V2 plugin definition', async () => {
    const plugin = await loadPlugin()

    expect(plugin.id).toBe('ocm.gh-env')
  })

  it('atomically replaces a symlink at the plugin path with a regular file', async () => {
    const pluginDir = getOpenCodePluginDir(configHome)
    const pluginFile = pluginPath()
    const symlinkTarget = path.join(pluginDir, 'attacker-hook.js')
    await fs.writeFile(symlinkTarget, 'export default { id: "attacker" }')
    await fs.rm(pluginFile, { force: true })
    await fs.symlink(symlinkTarget, pluginFile)

    await installManagedPlugins(configHome)

    const stat = await fs.lstat(pluginFile)
    expect(stat.isFile()).toBe(true)
    expect(stat.isSymbolicLink()).toBe(false)
    expect(await fs.readFile(pluginFile, 'utf-8')).toContain("id: 'ocm.gh-env'")
    expect(await fs.readFile(symlinkTarget, 'utf-8')).toBe('export default { id: "attacker" }')
  })

  it('throws when the plugin file cannot be written instead of swallowing the failure', async () => {
    const blockedHome = path.join(configHome, 'blocked')
    await fs.mkdir(blockedHome, { recursive: true })
    await fs.writeFile(path.join(blockedHome, 'opencode'), 'not a directory')

    await expect(installManagedPlugins(blockedHome)).rejects.toThrow()
  })

  it('removes the legacy Manager-owned V1 plugin file and preserves user files', async () => {
    const legacyDir = path.join(configHome, 'opencode', 'plugin')
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(legacyPluginPath(), 'export default async function () {}')
    await fs.writeFile(path.join(legacyDir, 'user-plugin.js'), 'export default { id: "user" }')

    await installManagedPlugins(configHome)

    await expect(fs.access(legacyPluginPath())).rejects.toThrow()
    expect(await fs.readFile(path.join(legacyDir, 'user-plugin.js'), 'utf-8')).toBe('export default { id: "user" }')
    await expect(fs.access(pluginPath())).resolves.toBeUndefined()
  })

  it('merges the fetched shell env into the create.before event env', async () => {
    const fetchMock = stubShellEnvFetch({ env: { GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' }, mask: [] })
    const plugin = await loadPlugin()
    const event = { command: 'git push', cwd: '/repo', env: { PATH: '/usr/bin' } }

    await plugin.triggerShellCreateBefore(event)

    expect(event.env).toEqual({ PATH: '/usr/bin', GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' })
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url.toString()).toBe('http://localhost:5003/api/internal/shell-env?cwd=%2Frepo')
    expect(options).toEqual({ headers: { Authorization: 'Bearer secret-token' } })
  })

  it('does not fetch when the internal env vars are missing', async () => {
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const plugin = await loadPlugin()
    const event = { command: 'git push', cwd: '/repo', env: {} }

    await plugin.triggerShellCreateBefore(event)

    expect(event.env).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws when the fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    const plugin = await loadPlugin()
    const event = { command: 'git push', cwd: '/repo', env: {} }

    await expect(plugin.triggerShellCreateBefore(event)).resolves.toBeUndefined()
    expect(event.env).toEqual({})
  })

  it('caches results within the TTL so rapid calls fetch once', async () => {
    const fetchMock = stubShellEnvFetch({ env: { GH_TOKEN: 'ghp' } })
    const plugin = await loadPlugin()
    const first = { command: 'git push', cwd: '/repo', env: {} }
    const second = { command: 'git push', cwd: '/repo', env: {} }

    await plugin.triggerShellCreateBefore(first)
    await plugin.triggerShellCreateBefore(second)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.env).toEqual({ GH_TOKEN: 'ghp' })
  })

  it('caches results per cwd', async () => {
    const fetchMock = stubShellEnvFetch({ env: { GH_TOKEN: 'ghp' } })
    const plugin = await loadPlugin()

    await plugin.triggerShellCreateBefore({ command: 'git push', cwd: '/repo-a', env: {} })
    await plugin.triggerShellCreateBefore({ command: 'git push', cwd: '/repo-b', env: {} })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0].toString()).toContain('cwd=%2Frepo-a')
    expect(fetchMock.mock.calls[1]![0].toString()).toContain('cwd=%2Frepo-b')
  })

  it('keeps the cached env when a later fetch fails', async () => {
    const realNow = Date.now
    const fetchMock = stubShellEnvFetch({ env: { GH_TOKEN: 'ghp' } })
    const plugin = await loadPlugin()
    const first = { command: 'git push', cwd: '/repo', env: {} }
    await plugin.triggerShellCreateBefore(first)
    expect(first.env).toEqual({ GH_TOKEN: 'ghp' })

    fetchMock.mockRejectedValue(new Error('network down'))
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 6000)
    const second = { command: 'git push', cwd: '/repo', env: {} }

    await expect(plugin.triggerShellCreateBefore(second)).resolves.toBeUndefined()
    expect(second.env).toEqual({ GH_TOKEN: 'ghp' })
  })

  it('masks learned secret values in output, content text and nested metadata for every tool', async () => {
    stubShellEnvFetch({ env: {}, mask: ['s3cret-value'] })
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    const event: ToolExecuteAfterEvent = {
      tool: 'read',
      status: 'completed',
      result: {
        output: 'token s3cret-value here',
        content: [{ type: 'text', text: 'also s3cret-value' }],
        metadata: { output: 'nested s3cret-value' },
      },
    }

    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toEqual({
      output: 'token *** here',
      content: [{ type: 'text', text: 'also ***' }],
      metadata: { output: 'nested ***' },
    })
  })

  it('masks a completed result that is not a plain object', async () => {
    stubShellEnvFetch({ env: {}, mask: ['s3cret-value'] })
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    class ToolResult {
      [key: string]: unknown
      output = 'token s3cret-value'
    }
    const event: ToolExecuteAfterEvent = { tool: 'shell', status: 'completed', result: new ToolResult() }

    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toEqual({ output: 'token ***' })
  })

  it('leaves error results untouched', async () => {
    stubShellEnvFetch({ env: {}, mask: ['s3cret-value'] })
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    const result = { output: 's3cret-value' }
    const event: ToolExecuteAfterEvent = { tool: 'shell', status: 'error', result }

    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toBe(result)
  })

  it('does not reallocate the result when no mask value occurs', async () => {
    stubShellEnvFetch({ env: {}, mask: ['s3cret-value'] })
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    const result = { output: 'nothing sensitive', content: [{ type: 'text', text: 'plain' }] }
    const event: ToolExecuteAfterEvent = { tool: 'shell', status: 'completed', result }

    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toBe(result)
  })

  it('replaces the masks for a cwd instead of keeping values that rotated out', async () => {
    const realNow = Date.now
    const fetchMock = stubShellEnvFetch({ env: {}, mask: ['first-secret'] })
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ env: {}, mask: ['second-secret'] }) })
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 6000)
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    const event: ToolExecuteAfterEvent = { tool: 'shell', status: 'completed', result: { output: 'first-secret and second-secret' } }

    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toEqual({ output: 'first-secret and ***' })
    expect(maskStateForTests()?.byCwd.get('/repo')).toEqual(['second-secret'])
  })

  it('keeps masks per cwd and masks a result with the masks of the cwd its shell ran in', async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL) => {
      const mask = String(url).includes('%2Frepo-a') ? ['a-secret'] : ['b-secret']
      return Promise.resolve({ ok: true, json: async () => ({ env: {}, mask }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo-a', env: {} })
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo-b', env: {} })

    const fromA: ToolExecuteAfterEvent = {
      tool: 'shell',
      status: 'completed',
      input: { command: 'ls', workdir: '/repo-a' },
      result: { output: 'a-secret and b-secret' },
    }
    await plugin.triggerToolExecuteAfter(fromA)

    expect(fromA.result).toEqual({ output: '*** and b-secret' })
  })

  it('masks a result without a cwd with the union of the current per-cwd masks', async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL) => {
      const mask = String(url).includes('%2Frepo-a') ? ['a-secret'] : ['b-secret']
      return Promise.resolve({ ok: true, json: async () => ({ env: {}, mask }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo-a', env: {} })
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo-b', env: {} })

    const event: ToolExecuteAfterEvent = {
      tool: 'read',
      status: 'completed',
      result: { output: 'a-secret and b-secret' },
    }
    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toEqual({ output: '*** and ***' })
  })

  it('masks overlapping values longest first without sorting per string', async () => {
    stubShellEnvFetch({ env: {}, mask: ['abc', 'abcdef', 'abc'] })
    const plugin = await loadPlugin()
    await plugin.triggerShellCreateBefore({ command: 'ls', cwd: '/repo', env: {} })

    expect(maskStateForTests()?.byCwd.get('/repo')).toEqual(['abcdef', 'abc'])

    const event: ToolExecuteAfterEvent = { tool: 'shell', status: 'completed', result: { output: 'abcdef' } }
    await plugin.triggerToolExecuteAfter(event)

    expect(event.result).toEqual({ output: '***' })
  })

  for (const order of ['gh-env first', 'sandbox first'] as const) {
    it(`lets a sandboxed shell register the plan masks and skips the repository env (${order})`, async () => {
      process.env.OCM_SANDBOX_ENFORCED = 'true'
      const shellEnvCalls: string[] = []
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const target = String(url)
        if (target.includes('/sandbox/sessions/')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ sandboxed: true, source: 'default', since: 1 }) })
        }
        if (target.endsWith('/sandbox/shell')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ mode: 'sandbox', workdir: '/repo', name: PLAN_NAME, mask: ['plan-secret'] }),
          })
        }
        shellEnvCalls.push(target)
        return Promise.resolve({ ok: true, json: async () => ({ env: { GH_TOKEN: 'ghp' }, mask: ['repo-secret'] }) })
      }))
      const ghEnv = await loadPlugin()
      const sandbox = await loadGeneratedPlugin(path.join(getOpenCodePluginDir(configHome), 'ocm-sandbox.js'))
      const base = vi.fn().mockImplementation(async (input: { command: string }) => {
        const event = shellCreateEvent(input.command, '/repo')
        if (order === 'gh-env first') {
          await ghEnv.triggerShellCreateBefore(event)
          await sandbox.triggerShellCreateBefore(event)
        } else {
          await sandbox.triggerShellCreateBefore(event)
          await ghEnv.triggerShellCreateBefore(event)
        }
        return { output: 'ok' }
      })
      const shell = shellTool(sandbox, base)

      await shell.execute!({ command: 'git push' }, { signal: new AbortController().signal, sessionID: 'ses_test', id: 'call_test' })

      expect(shellEnvCalls).toHaveLength(1)
      expect(shellEnvCalls[0]).toContain('sandboxed=1')
      expect(maskStateForTests()?.byCwd.get('/repo')).toEqual(['plan-secret'])
      expect(shellSandboxStateForTests()?.inFlightSandboxedCommands.size).toBe(0)

      const event: ToolExecuteAfterEvent = { tool: 'shell', status: 'completed', result: { output: 'plan-secret and repo-secret' } }
      await ghEnv.triggerToolExecuteAfter(event)

      expect(event.result).toEqual({ output: '*** and repo-secret' })
    })
  }

  it('fails loudly when the generated module does not match the V2 plugin contract', async () => {
    const modulePath = path.join(configHome, 'not-a-plugin.js')
    await fs.writeFile(modulePath, 'export default async function () { return {} }')

    await expect(loadGeneratedPlugin(modulePath)).rejects.toThrow(/plugin definition object/)
  })
})
