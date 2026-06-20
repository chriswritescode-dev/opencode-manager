import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { pathToFileURL } from 'url'
import { installGhEnvPlugin, getGhEnvPluginDir } from '../../src/services/opencode-gh-env-plugin'

type ShellEnvHook = (
  input: { cwd: string },
  output: { env: Record<string, string> },
) => Promise<void>
type PluginFactory = () => Promise<{ 'shell.env': ShellEnvHook }>

async function loadPlugin(configHome: string): Promise<PluginFactory> {
  const file = path.join(getGhEnvPluginDir(configHome), 'ocm-gh-env.js')
  const mod = await import(pathToFileURL(file).href)
  return mod.default as PluginFactory
}

describe('ocm-gh-env plugin', () => {
  let configHome: string

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-ghenv-'))
    await installGhEnvPlugin(configHome)
    process.env.OCM_INTERNAL_API_URL = 'http://localhost:5003/api/internal'
    process.env.OCM_INTERNAL_TOKEN = 'secret-token'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    await fs.rm(configHome, { recursive: true, force: true })
  })

  it('writes the plugin file into the auto-discovery dir', async () => {
    const file = path.join(getGhEnvPluginDir(configHome), 'ocm-gh-env.js')
    await expect(fs.access(file)).resolves.toBeUndefined()
  })

  it('injects fetched GH env into output.env', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const factory = await loadPlugin(configHome)
    const hooks = await factory()
    const output = { env: {} as Record<string, string> }
    await hooks['shell.env']({ cwd: '/repo' }, output)

    expect(output.env).toEqual({ GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5003/api/internal/git-credentials/gh-env',
      { headers: { Authorization: 'Bearer secret-token' } },
    )
  })

  it('does not fetch when the internal env vars are missing', async () => {
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const factory = await loadPlugin(configHome)
    const hooks = await factory()
    const output = { env: {} as Record<string, string> }
    await hooks['shell.env']({ cwd: '/repo' }, output)

    expect(output.env).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws when the fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const factory = await loadPlugin(configHome)
    const hooks = await factory()
    const output = { env: {} as Record<string, string> }

    await expect(hooks['shell.env']({ cwd: '/repo' }, output)).resolves.toBeUndefined()
    expect(output.env).toEqual({})
  })

  it('caches results within the TTL so rapid calls fetch once', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const factory = await loadPlugin(configHome)
    const hooks = await factory()
    const out1 = { env: {} as Record<string, string> }
    const out2 = { env: {} as Record<string, string> }
    await hooks['shell.env']({ cwd: '/repo' }, out1)
    await hooks['shell.env']({ cwd: '/repo' }, out2)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(out2.env).toEqual({ GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' })
  })
})
