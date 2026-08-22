import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import {
  quarantineOpenCodePlugins,
  restoreQuarantinedOpenCodePlugins,
} from '../../src/services/opencode-plugin-quarantine'
import { TRUSTED_OPENCODE_PLUGIN_FILENAMES } from '../../src/services/opencode/plugin-registry'

describe('opencode plugin quarantine', () => {
  let root: string
  let configHome: string
  let configPath: string
  let originalHome: string | undefined

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ocm-plugin-quarantine-'))
    configHome = path.join(root, '.config')
    configPath = path.join(configHome, 'opencode', 'opencode.json')
    mkdirSync(path.join(configHome, 'opencode', 'plugin'), { recursive: true })
    mkdirSync(path.join(configHome, 'opencode', 'plugins'), { recursive: true })
    originalHome = process.env.HOME
    process.env.HOME = path.join(root, 'home')
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'ocm-sandbox.js'), 'export default async function () {}')
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'ocm-gh-env.js'), 'export default async function () {}')
  })

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    delete process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
    await fs.rm(root, { recursive: true, force: true })
  })

  function writeConfig(content: Record<string, unknown>) {
    writeFileSync(configPath, JSON.stringify(content, null, 2))
  }

  it('quarantines every non-manager plugin dir entry, including manager-named files, while keeping the manager plugins', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'user code')
    writeFileSync(path.join(configHome, 'opencode', 'plugins', 'extra.js'), 'extra code')
    writeFileSync(path.join(configHome, 'opencode', 'plugins', 'ocm-sandbox.js'), 'malicious sandbox')
    mkdirSync(path.join(process.env.HOME!, '.opencode', 'plugin'), { recursive: true })
    writeFileSync(path.join(process.env.HOME!, '.opencode', 'plugin', 'home-plugin.js'), 'home code')
    writeFileSync(path.join(process.env.HOME!, '.opencode', 'plugin', 'ocm-gh-env.js'), 'malicious env')
    mkdirSync(path.join(process.env.HOME!, '.opencode', 'plugins'), { recursive: true })
    writeFileSync(path.join(process.env.HOME!, '.opencode', 'plugins', 'ocm-sandbox.js'), 'malicious sandbox 2')
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect((await fs.readdir(path.join(configHome, 'opencode', 'plugin'))).sort()).toEqual(
      [...TRUSTED_OPENCODE_PLUGIN_FILENAMES].sort(),
    )
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugins'))).toEqual([])
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'plugin'))).toEqual([])
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'plugins'))).toEqual([])
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugin.ocm-quarantine'))).toContain('user-plugin.js')
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugins.ocm-quarantine'))).toContain('extra.js')
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugins.ocm-quarantine'))).toContain('ocm-sandbox.js')
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'plugin.ocm-quarantine'))).toContain('home-plugin.js')
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'plugin.ocm-quarantine'))).toContain('ocm-gh-env.js')
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'plugins.ocm-quarantine'))).toContain('ocm-sandbox.js')
  })

  it('restores manager-named files quarantined from non-manager plugin dirs once enforcement is off', async () => {
    mkdirSync(path.join(configHome, 'opencode', 'plugins'), { recursive: true })
    writeFileSync(path.join(configHome, 'opencode', 'plugins', 'ocm-sandbox.js'), 'user version')
    mkdirSync(path.join(process.env.HOME!, '.opencode', 'plugin'), { recursive: true })
    writeFileSync(path.join(process.env.HOME!, '.opencode', 'plugin', 'ocm-gh-env.js'), 'user version')
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugins', 'ocm-sandbox.js'), 'utf-8')).toBe(
      'user version',
    )
    expect(await fs.readFile(path.join(process.env.HOME!, '.opencode', 'plugin', 'ocm-gh-env.js'), 'utf-8')).toBe(
      'user version',
    )
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugins.ocm-quarantine'))).toEqual([])
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'plugin.ocm-quarantine'))).toEqual([])
  })

  it('quarantines global custom tool directories and restores them once enforcement is off', async () => {
    mkdirSync(path.join(configHome, 'opencode', 'tools'), { recursive: true })
    writeFileSync(path.join(configHome, 'opencode', 'tools', 'evil-tool.js'), 'global tool code')
    mkdirSync(path.join(configHome, 'opencode', 'tool'), { recursive: true })
    writeFileSync(path.join(configHome, 'opencode', 'tool', 'singular.ts'), 'singular tool code')
    mkdirSync(path.join(process.env.HOME!, '.opencode', 'tools'), { recursive: true })
    writeFileSync(path.join(process.env.HOME!, '.opencode', 'tools', 'home-tool.js'), 'home tool code')
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(await fs.readdir(path.join(configHome, 'opencode', 'tools'))).toEqual([])
    expect(await fs.readdir(path.join(configHome, 'opencode', 'tool'))).toEqual([])
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'tools'))).toEqual([])
    expect(await fs.readdir(path.join(configHome, 'opencode', 'tools.ocm-quarantine'))).toContain('evil-tool.js')
    expect(await fs.readdir(path.join(configHome, 'opencode', 'tool.ocm-quarantine'))).toContain('singular.ts')
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'tools.ocm-quarantine'))).toContain('home-tool.js')

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'tools', 'evil-tool.js'), 'utf-8')).toBe('global tool code')
    expect(await fs.readFile(path.join(configHome, 'opencode', 'tool', 'singular.ts'), 'utf-8')).toBe('singular tool code')
    expect(await fs.readFile(path.join(process.env.HOME!, '.opencode', 'tools', 'home-tool.js'), 'utf-8')).toBe(
      'home tool code',
    )
    expect(await fs.readdir(path.join(configHome, 'opencode', 'tools.ocm-quarantine'))).toEqual([])
    expect(await fs.readdir(path.join(configHome, 'opencode', 'tool.ocm-quarantine'))).toEqual([])
    expect(await fs.readdir(path.join(process.env.HOME!, '.opencode', 'tools.ocm-quarantine'))).toEqual([])
  })

  it('keeps the original quarantine copy and preserves a same-name replacement under a conflict name', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v2')
    await quarantineOpenCodePlugins(configHome, configPath)

    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin.ocm-quarantine', 'user-plugin.js'), 'utf-8'),
    ).toBe('v1')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin.ocm-quarantine', 'user-plugin.js.ocm-conflict1'), 'utf-8'),
    ).toBe('v2')
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugin'))).toHaveLength(2)
  })

  it('keeps every same-name replacement across repeated enforced restarts recoverable', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v2')
    await quarantineOpenCodePlugins(configHome, configPath)

    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v3')
    await quarantineOpenCodePlugins(configHome, configPath)

    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin.js'), 'utf-8')).toBe('v1')
    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin.js.ocm-conflict1'), 'utf-8')).toBe('v2')
    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin.js.ocm-conflict2'), 'utf-8')).toBe('v3')
  })

  it('strips LSP servers and experimental hook commands while keeping other experimental settings', async () => {
    writeConfig({
      lsp: { typescript: { command: ['typescript-language-server', '--stdio'] } },
      experimental: {
        hook: { file_edited: [{ command: ['chmod', '+x', 'script.sh'] }] },
        chatMaxRetries: 4,
      },
      model: 'x',
    })

    await quarantineOpenCodePlugins(configHome, configPath)

    const sanitized = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(sanitized.lsp).toBeUndefined()
    expect(sanitized.experimental).toEqual({ chatMaxRetries: 4 })
    expect(sanitized.model).toBe('x')
    const backup = JSON.parse(
      await fs.readFile(`${configPath}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.removedSections).toEqual({
      lsp: { typescript: { command: ['typescript-language-server', '--stdio'] } },
      experimentalHook: { file_edited: [{ command: ['chmod', '+x', 'script.sh'] }] },
    })
  })

  it('strips an enabling lsp boolean and the shell configuration while enforced and restores them later', async () => {
    writeConfig({
      lsp: true,
      shell: { command: '/repo/.bin/evil-shell', args: [] },
      model: 'x',
    })

    await quarantineOpenCodePlugins(configHome, configPath)

    const sanitized = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(sanitized.lsp).toBeUndefined()
    expect(sanitized.shell).toBeUndefined()
    expect(sanitized.model).toBe('x')
    const backup = JSON.parse(
      await fs.readFile(`${configPath}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.removedSections).toEqual({
      lsp: true,
      shell: { command: '/repo/.bin/evil-shell', args: [] },
    })

    writeConfig({ model: 'y' })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.lsp).toBe(true)
    expect(restored.shell).toEqual({ command: '/repo/.bin/evil-shell', args: [] })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('does not overwrite a same-name remote MCP server added while enforcement was active', async () => {
    writeConfig({ mcp: { build: { type: 'local', command: ['node', 'build.js'] } } })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ mcp: { build: { type: 'remote', url: 'https://example.com/mcp' } } })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.mcp).toEqual({ build: { type: 'remote', url: 'https://example.com/mcp' } })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('sanitizes and restores every native global config file alongside the manager config', async () => {
    const jsoncPath = path.join(configHome, 'opencode', 'opencode.jsonc')
    const configJsonPath = path.join(configHome, 'opencode', 'config.json')
    writeFileSync(jsoncPath, JSON.stringify({ plugin: ['evil-plugin'], model: 'x' }))
    writeFileSync(configJsonPath, JSON.stringify({ shell: { command: '/repo/.bin/evil-shell' }, lsp: true }))
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(jsoncPath, 'utf-8'))).toEqual({ model: 'x' })
    expect(JSON.parse(await fs.readFile(configJsonPath, 'utf-8'))).toEqual({})
    await expect(fs.access(`${jsoncPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()
    await expect(fs.access(`${configJsonPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(jsoncPath, 'utf-8'))).toEqual({ plugin: ['evil-plugin'], model: 'x' })
    expect(JSON.parse(await fs.readFile(configJsonPath, 'utf-8'))).toEqual({
      shell: { command: '/repo/.bin/evil-shell' },
      lsp: true,
    })
    await expect(fs.access(`${jsoncPath}.ocm-sandbox-backup`)).rejects.toThrow()
    await expect(fs.access(`${configJsonPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('sanitizes and restores the home-level .opencode config files', async () => {
    const homeDir = process.env.HOME!
    const homeJsonPath = path.join(homeDir, '.opencode', 'opencode.json')
    const homeJsoncPath = path.join(homeDir, '.opencode', 'opencode.jsonc')
    mkdirSync(path.dirname(homeJsonPath), { recursive: true })
    writeFileSync(homeJsonPath, JSON.stringify({ plugin: ['home-plugin'], model: 'x' }))
    writeFileSync(homeJsoncPath, JSON.stringify({ shell: { command: '/repo/.bin/evil-shell' }, lsp: true }))
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(homeJsonPath, 'utf-8'))).toEqual({ model: 'x' })
    expect(JSON.parse(await fs.readFile(homeJsoncPath, 'utf-8'))).toEqual({})
    await expect(fs.access(`${homeJsonPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()
    await expect(fs.access(`${homeJsoncPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(homeJsonPath, 'utf-8'))).toEqual({ plugin: ['home-plugin'], model: 'x' })
    expect(JSON.parse(await fs.readFile(homeJsoncPath, 'utf-8'))).toEqual({
      shell: { command: '/repo/.bin/evil-shell' },
      lsp: true,
    })
    await expect(fs.access(`${homeJsonPath}.ocm-sandbox-backup`)).rejects.toThrow()
    await expect(fs.access(`${homeJsoncPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('leaves a home-level config file without host-execution sections untouched', async () => {
    const homeJsonPath = path.join(process.env.HOME!, '.opencode', 'opencode.json')
    mkdirSync(path.dirname(homeJsonPath), { recursive: true })
    writeFileSync(homeJsonPath, JSON.stringify({ model: 'x' }))
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(homeJsonPath, 'utf-8'))).toEqual({ model: 'x' })
    await expect(fs.access(`${homeJsonPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('strips custom provider npm selectors from config files and restores them later', async () => {
    writeConfig({
      model: 'x',
      provider: {
        builtin: { options: { apiKey: 'k' } },
        evil: { npm: 'file:///repo/evil-provider.js', options: { token: 't' } },
      },
    })

    await quarantineOpenCodePlugins(configHome, configPath)

    const sanitized = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(sanitized.provider).toEqual({ builtin: { options: { apiKey: 'k' } } })
    expect(sanitized.model).toBe('x')
    const backup = JSON.parse(
      await fs.readFile(`${configPath}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.removedSections).toEqual({
      provider: { evil: { npm: 'file:///repo/evil-provider.js', options: { token: 't' } } },
    })

    writeConfig({ provider: { builtin: { options: { apiKey: 'k' } } }, model: 'y' })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.provider).toEqual({
      builtin: { options: { apiKey: 'k' } },
      evil: { npm: 'file:///repo/evil-provider.js', options: { token: 't' } },
    })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('fails closed when a native global config file cannot be parsed', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'config.json'), '{not json')
    writeConfig({})

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/cannot parse OpenCode config/)
  })

  it('restores LSP servers and experimental hook commands once enforcement is off', async () => {
    writeConfig({
      lsp: { typescript: { command: ['typescript-language-server'] } },
      experimental: {
        hook: { session_completed: [{ command: ['echo', 'done'] }] },
        chatMaxRetries: 4,
      },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ experimental: { chatMaxRetries: 8 }, model: 'y' })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.lsp).toEqual({ typescript: { command: ['typescript-language-server'] } })
    expect(restored.experimental).toEqual({
      chatMaxRetries: 8,
      hook: { session_completed: [{ command: ['echo', 'done'] }] },
    })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('leaves a config with only a disabled lsp flag and no hook untouched', async () => {
    writeConfig({ lsp: false, experimental: { chatMaxRetries: 4 }, model: 'x' })

    await quarantineOpenCodePlugins(configHome, configPath)

    const content = await fs.readFile(configPath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ lsp: false, experimental: { chatMaxRetries: 4 }, model: 'x' })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('restores the original quarantine copy and leaves later collisions recoverable', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v2')
    await quarantineOpenCodePlugins(configHome, configPath)

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('v1')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin.ocm-quarantine', 'user-plugin.js.ocm-conflict1'), 'utf-8'),
    ).toBe('v2')
  })

  it('keeps both versions of a same-name plugin directory recoverable', async () => {
    const activeDir = path.join(configHome, 'opencode', 'plugin', 'user-plugin')
    mkdirSync(activeDir, { recursive: true })
    writeFileSync(path.join(activeDir, 'index.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    const activeDir2 = path.join(configHome, 'opencode', 'plugin', 'user-plugin')
    mkdirSync(activeDir2, { recursive: true })
    writeFileSync(path.join(activeDir2, 'index.js'), 'v2')
    await quarantineOpenCodePlugins(configHome, configPath)

    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin', 'index.js'), 'utf-8')).toBe('v1')
    expect(
      await fs.readFile(path.join(quarantineDir, 'user-plugin.ocm-conflict1', 'index.js'), 'utf-8'),
    ).toBe('v2')

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)
    expect(await fs.readFile(path.join(activeDir, 'index.js'), 'utf-8')).toBe('v1')
    expect(
      await fs.readFile(path.join(quarantineDir, 'user-plugin.ocm-conflict1', 'index.js'), 'utf-8'),
    ).toBe('v2')
  })

  it('strips the plugin array from the config and backs up the original', async () => {
    writeConfig({ plugin: ['my-plugin', ['file:///repo/plugin.js', {}]], model: 'x' })

    await quarantineOpenCodePlugins(configHome, configPath)

    const sanitized = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(sanitized.plugin).toBeUndefined()
    expect(sanitized.model).toBe('x')
    const backup = JSON.parse(
      await fs.readFile(`${configPath}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.originalPlugins).toEqual(['my-plugin', ['file:///repo/plugin.js', {}]])
    expect(backup.sanitizedConfig).toEqual({ model: 'x' })
  })

  it('strips every MCP server that is not provably remote along with the formatter', async () => {
    writeConfig({
      mcp: {
        local: { type: 'local', command: ['npx', 'evil-server'] },
        shorthand: { command: ['node', 'server.js'] },
        stringCommand: { command: 'node server.js' },
        remote: { type: 'remote', url: 'https://example.com/mcp' },
        toggled: { enabled: false },
      },
      formatter: { typescript: { command: ['prettier', '--write'] } },
      model: 'x',
    })

    await quarantineOpenCodePlugins(configHome, configPath)

    const sanitized = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(sanitized.mcp).toEqual({
      remote: { type: 'remote', url: 'https://example.com/mcp' },
    })
    expect(sanitized.formatter).toBeUndefined()
    expect(sanitized.model).toBe('x')
    const backup = JSON.parse(
      await fs.readFile(`${configPath}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.removedSections).toEqual({
      mcp: {
        local: { type: 'local', command: ['npx', 'evil-server'] },
        shorthand: { command: ['node', 'server.js'] },
        stringCommand: { command: 'node server.js' },
        toggled: { enabled: false },
      },
      formatter: { typescript: { command: ['prettier', '--write'] } },
    })
  })

  it('restores local MCP servers and the formatter once enforcement is off', async () => {
    writeConfig({
      mcp: {
        local: { type: 'local', command: ['npx', 'evil-server'] },
        remote: { type: 'remote', url: 'https://example.com/mcp' },
      },
      formatter: { typescript: { command: ['prettier', '--write'] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } }, model: 'y' })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.mcp).toEqual({
      remote: { type: 'remote', url: 'https://example.com/mcp' },
      local: { type: 'local', command: ['npx', 'evil-server'] },
    })
    expect(restored.formatter).toEqual({ typescript: { command: ['prettier', '--write'] } })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('keeps the original local MCP and formatter choices across an unchanged second enforced start', async () => {
    writeConfig({
      mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } },
      formatter: { typescript: { command: ['prettier'] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)
    await quarantineOpenCodePlugins(configHome, configPath)
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.mcp).toEqual({ local: { type: 'local', command: ['npx', 'evil-server'] } })
    expect(restored.formatter).toEqual({ typescript: { command: ['prettier'] } })
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('keeps every quarantined section backed up across an unrelated safe config edit during enforcement', async () => {
    writeConfig({
      mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } },
      formatter: { typescript: { command: ['prettier', '--write'] } },
      shell: { command: '/repo/.bin/evil-shell', args: [] },
      experimental: { hook: { file_edited: [{ command: ['chmod', '+x', 'script.sh'] }] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ model: 'y' })
    await quarantineOpenCodePlugins(configHome, configPath)
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.mcp).toEqual({ local: { type: 'local', command: ['npx', 'evil-server'] } })
    expect(restored.formatter).toEqual({ typescript: { command: ['prettier', '--write'] } })
    expect(restored.shell).toEqual({ command: '/repo/.bin/evil-shell', args: [] })
    expect(restored.experimental).toEqual({ hook: { file_edited: [{ command: ['chmod', '+x', 'script.sh'] }] } })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('refuses to overwrite a corrupt backup so the sections it holds are never lost', async () => {
    writeConfig({
      mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } },
      formatter: { typescript: { command: ['prettier'] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    const backupPath = `${configPath}.ocm-sandbox-backup`
    const corrupt = '{ "removedSections": '
    writeFileSync(backupPath, corrupt)

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/refusing to overwrite it/)
    expect(await fs.readFile(backupPath, 'utf-8')).toBe(corrupt)
  })

  it('refuses to overwrite a backup that holds no recoverable removed sections', async () => {
    writeConfig({
      mcp: { local: { type: 'local', command: ['npx', 'evil-server'] } },
      formatter: { typescript: { command: ['prettier'] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    const backupPath = `${configPath}.ocm-sandbox-backup`
    writeFileSync(backupPath, '{}')

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/refusing to overwrite it/)
    expect(await fs.readFile(backupPath, 'utf-8')).toBe('{}')
  })

  it('accepts a legacy backup that recorded an empty plugin list', async () => {
    writeConfig({ plugin: ['my-plugin'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    const backupPath = `${configPath}.ocm-sandbox-backup`
    writeFileSync(backupPath, JSON.stringify({ originalPlugins: [] }))

    await expect(quarantineOpenCodePlugins(configHome, configPath)).resolves.toBeUndefined()
  })

  it('replaces a quarantined section with a newly supplied prohibited value while preserving other backed-up sections', async () => {
    writeConfig({
      mcp: { local: { type: 'local', command: ['npx', 'old-server'] } },
      formatter: { typescript: { command: ['prettier'] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({
      mcp: { local: { type: 'local', command: ['npx', 'new-server'] }, remote: { type: 'remote', url: 'https://example.com/mcp' } },
      formatter: { typescript: { command: ['prettier', '--write'] } },
      model: 'y',
    })
    await quarantineOpenCodePlugins(configHome, configPath)
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.mcp).toEqual({
      local: { type: 'local', command: ['npx', 'new-server'] },
      remote: { type: 'remote', url: 'https://example.com/mcp' },
    })
    expect(restored.formatter).toEqual({ typescript: { command: ['prettier', '--write'] } })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('does not overwrite an experimental hook created while enforcement was active', async () => {
    writeConfig({
      experimental: { hook: { session_started: [{ command: ['echo', 'original'] }] } },
      model: 'x',
    })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({
      experimental: { hook: { session_started: [{ command: ['echo', 'newer'] }] }, chatMaxRetries: 4 },
      model: 'y',
    })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.experimental).toEqual({
      hook: { session_started: [{ command: ['echo', 'newer'] }] },
      chatMaxRetries: 4,
    })
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('leaves the config untouched when it has no host-execution sections', async () => {
    writeConfig({ model: 'x', mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } } })

    await quarantineOpenCodePlugins(configHome, configPath)

    const content = await fs.readFile(configPath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ model: 'x', mcp: { remote: { type: 'remote', url: 'https://example.com/mcp' } } })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('leaves the config untouched when it has no plugin array', async () => {
    writeConfig({ model: 'x' })

    await quarantineOpenCodePlugins(configHome, configPath)

    const content = await fs.readFile(configPath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ model: 'x' })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('refreshes the plugin backup when the config changes during enforcement and restores the latest choices', async () => {
    writeConfig({ plugin: ['plugin-a'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ plugin: ['plugin-b'], model: 'y' })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ model: 'y' })
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['plugin-b'])
    expect(restored.model).toBe('y')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('keeps the original backed-up plugin choice across an unchanged second enforced start', async () => {
    writeConfig({ plugin: ['plugin-a'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    await quarantineOpenCodePlugins(configHome, configPath)

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['plugin-a'])
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('refreshes the backup when a plugin is added to the sanitized config during enforcement', async () => {
    writeConfig({ plugin: ['plugin-a'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ plugin: ['plugin-b'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['plugin-b'])
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('restores plugins whose config entry disappeared during enforcement once enforcement is disabled', async () => {
    writeConfig({ plugin: ['plugin-a'] })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['plugin-a'])
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('keeps an explicitly emptied plugin list removed after enforcement is disabled', async () => {
    writeConfig({ plugin: ['plugin-a'] })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ plugin: [], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual([])
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('restores quarantined plugin files and merges the backed-up plugin array back in', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'user code')
    writeConfig({ plugin: ['my-plugin'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeConfig({ model: 'x', extra: true })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugin'))).toContain('user-plugin.js')
    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['my-plugin'])
    expect(restored.model).toBe('x')
    expect(restored.extra).toBe(true)
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('does not overwrite an active plugin file during restore and keeps the config as-is when it already has plugins', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'quarantined copy')
    writeConfig({ plugin: ['my-plugin'] })
    await quarantineOpenCodePlugins(configHome, configPath)

    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'active replacement')
    writeConfig({ plugin: ['other-plugin'], model: 'x' })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('active replacement')
    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['other-plugin'])
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('fails closed when a plugin directory cannot be inspected', async () => {
    await fs.rm(path.join(configHome, 'opencode', 'plugin'), { recursive: true, force: true })
    await fs.writeFile(path.join(configHome, 'opencode', 'plugin'), 'not a directory')
    writeConfig({})

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow()
  })

  it('keeps the previous config and a parseable backup when the sanitized config replacement fails', async () => {
    writeConfig({ plugin: ['my-plugin'], model: 'x' })
    const renameOriginal = fs.rename.bind(fs)
    const renameSpy = vi.spyOn(fs, 'rename')
    let renameCalls = 0
    renameSpy.mockImplementation(async (from, to) => {
      renameCalls += 1
      if (renameCalls === 2) throw new Error('disk full')
      return renameOriginal(from, to)
    })

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow('disk full')
    renameSpy.mockRestore()

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(config.plugin).toEqual(['my-plugin'])
    expect(config.model).toBe('x')
    const backup = JSON.parse(
      await fs.readFile(`${configPath}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect(backup.originalPlugins).toEqual(['my-plugin'])

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)
    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['my-plugin'])
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('keeps the backup until the restored config replacement succeeds', async () => {
    writeConfig({ plugin: ['my-plugin'], model: 'x' })
    await quarantineOpenCodePlugins(configHome, configPath)

    const renameSpy = vi.spyOn(fs, 'rename')
    renameSpy.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow('disk full')
    renameSpy.mockRestore()

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(config.plugin).toBeUndefined()
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)
    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['my-plugin'])
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('rejects an enforced quarantine when a plugin directory is a symlink and leaves the target untouched', async () => {
    const externalTarget = path.join(root, 'external-plugins')
    mkdirSync(externalTarget, { recursive: true })
    writeFileSync(path.join(externalTarget, 'victim.js'), 'external code')
    await fs.rm(path.join(configHome, 'opencode', 'plugin'), { recursive: true, force: true })
    await fs.symlink(externalTarget, path.join(configHome, 'opencode', 'plugin'))
    writeConfig({})

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/symbolic link/)

    expect(await fs.readdir(externalTarget)).toEqual(['victim.js'])
    expect(await fs.readFile(path.join(externalTarget, 'victim.js'), 'utf-8')).toBe('external code')
  })

  it('rejects an enforced quarantine when the quarantine directory itself is a symlink', async () => {
    const externalTarget = path.join(root, 'external-quarantine')
    mkdirSync(externalTarget, { recursive: true })
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'user code')
    await fs.symlink(externalTarget, path.join(configHome, 'opencode', 'plugin.ocm-quarantine'))
    writeConfig({})

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/symbolic link/)

    expect(await fs.readdir(externalTarget)).toEqual([])
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('user code')
  })

  it('rejects a restore through a symlinked plugin directory without touching the symlink target', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    const externalTarget = path.join(root, 'external-active')
    mkdirSync(externalTarget, { recursive: true })
    writeFileSync(path.join(externalTarget, 'marker.js'), 'marker')
    await fs.rm(path.join(configHome, 'opencode', 'plugin'), { recursive: true, force: true })
    await fs.symlink(externalTarget, path.join(configHome, 'opencode', 'plugin'))

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/symbolic link/)

    expect(await fs.readdir(externalTarget)).toEqual(['marker.js'])
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin.ocm-quarantine', 'user-plugin.js'), 'utf-8'),
    ).toBe('v1')
  })

  it('quarantines and restores through a legitimate symlinked ancestor directory', async () => {
    const realBase = path.join(root, 'real-base')
    mkdirSync(path.join(realBase, '.config', 'opencode', 'plugin'), { recursive: true })
    writeFileSync(path.join(realBase, '.config', 'opencode', 'plugin', 'user-plugin.js'), 'user code')
    await fs.symlink(realBase, path.join(root, 'linked-base'))
    const linkedConfigHome = path.join(root, 'linked-base', '.config')
    const linkedConfigPath = path.join(linkedConfigHome, 'opencode', 'opencode.json')

    await quarantineOpenCodePlugins(linkedConfigHome, linkedConfigPath)

    expect(await fs.readdir(path.join(realBase, '.config', 'opencode', 'plugin'))).toEqual([])
    expect(
      await fs.readdir(path.join(realBase, '.config', 'opencode', 'plugin.ocm-quarantine')),
    ).toContain('user-plugin.js')

    await restoreQuarantinedOpenCodePlugins(linkedConfigHome, linkedConfigPath)

    expect(await fs.readdir(path.join(realBase, '.config', 'opencode', 'plugin'))).toContain('user-plugin.js')
    expect(
      await fs.readFile(path.join(realBase, '.config', 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('user code')
    expect(
      await fs.readdir(path.join(realBase, '.config', 'opencode', 'plugin.ocm-quarantine')),
    ).toEqual([])
  })

  it('round-trips a legitimate plugin file whose name ends in .ocm-conflict<digits>', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'audit.ocm-conflict1'), 'legit plugin')
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'audit.ocm-conflict1'), 'utf-8'),
    ).toBe('legit plugin')
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugin.ocm-quarantine'))).toEqual([])
  })

  it('keeps every legal plugin filename unchanged through a quarantine and restore round-trip', async () => {
    const names = ['alpha.js', 'audit.ocm-conflict1', 'user-plugin.ocm-conflict42', 'beta.ocm-conflict']
    for (const name of names) {
      writeFileSync(path.join(configHome, 'opencode', 'plugin', name), `content:${name}`)
    }
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)
    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    for (const name of names) {
      expect(
        await fs.readFile(path.join(configHome, 'opencode', 'plugin', name), 'utf-8'),
      ).toBe(`content:${name}`)
    }
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugin.ocm-quarantine'))).toEqual([])
  })

  it('keeps a legit .ocm-conflict1 file recoverable alongside a repeated same-name collision', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'shared.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'shared.js'), 'v2')
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'shared.ocm-conflict1'), 'legit second file')
    await quarantineOpenCodePlugins(configHome, configPath)

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'shared.js'), 'utf-8')).toBe('v1')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'shared.ocm-conflict1'), 'utf-8'),
    ).toBe('legit second file')
    expect(
      await fs.readdir(path.join(configHome, 'opencode', 'plugin.ocm-quarantine')),
    ).toEqual(['shared.js.ocm-conflict1'])
  })

  it('restores a legacy quarantine without a manifest, preserving conflict copies only when their base exists', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'foo.js'), 'foo v1')
    writeFileSync(path.join(quarantineDir, 'foo.js.ocm-conflict1'), 'foo v2')
    writeFileSync(path.join(quarantineDir, 'audit.ocm-conflict1'), 'legit legacy file')
    writeConfig({})

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'foo.js'), 'utf-8')).toBe('foo v1')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'audit.ocm-conflict1'), 'utf-8'),
    ).toBe('legit legacy file')
    expect(await fs.readdir(quarantineDir)).toEqual(['foo.js.ocm-conflict1'])
  })

  it('ignores a malicious quarantine manifest path that escapes the plugin directory during restore', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v1')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    const escapedTarget = path.join(root, 'escaped-target')
    await fs.writeFile(
      path.join(quarantineDir, '.ocm-quarantine-manifest.json'),
      JSON.stringify({
        version: 1,
        entries: {
          'user-plugin.js': { original: '../../escaped-target', order: 1 },
        },
      }),
    )

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    await expect(fs.access(escapedTarget)).rejects.toThrow()
    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8')).toBe('v1')
    expect(await fs.readdir(quarantineDir)).toEqual([])
  })

  it('restores safely when the quarantine manifest contains a traversal key and a non-numeric order', async () => {
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'v1')
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'other.js'), 'v2')
    writeConfig({})
    await quarantineOpenCodePlugins(configHome, configPath)

    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    await fs.writeFile(
      path.join(quarantineDir, '.ocm-quarantine-manifest.json'),
      JSON.stringify({
        version: 1,
        entries: {
          '../../evil.js': { original: 'user-plugin.js', order: 1 },
          'other.js': { original: 'other.js', order: 'not-a-number' },
        },
      }),
    )

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8')).toBe('v1')
    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'other.js'), 'utf-8')).toBe('v2')
    await expect(fs.access(path.join(root, 'evil.js'))).rejects.toThrow()
    expect(await fs.readdir(quarantineDir)).toEqual([])
  })

  it('sanitizes and restores managed config files from the system managed config directory', async () => {
    const managedDir = path.join(root, 'managed')
    process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = managedDir
    mkdirSync(managedDir, { recursive: true })
    writeFileSync(path.join(managedDir, 'opencode.json'), JSON.stringify({ plugin: ['evil-plugin'], model: 'x' }))
    writeFileSync(path.join(managedDir, 'opencode.jsonc'), JSON.stringify({ shell: { command: '/repo/.bin/evil-shell' } }))
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(path.join(managedDir, 'opencode.json'), 'utf-8'))).toEqual({ model: 'x' })
    expect(JSON.parse(await fs.readFile(path.join(managedDir, 'opencode.jsonc'), 'utf-8'))).toEqual({})
    const backup = JSON.parse(
      await fs.readFile(`${path.join(managedDir, 'opencode.json')}.ocm-sandbox-backup`, 'utf-8'),
    ) as Record<string, unknown>
    expect((backup.removedSections as Record<string, unknown>).plugin).toEqual(['evil-plugin'])

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(path.join(managedDir, 'opencode.json'), 'utf-8'))).toEqual({
      plugin: ['evil-plugin'],
      model: 'x',
    })
    expect(JSON.parse(await fs.readFile(path.join(managedDir, 'opencode.jsonc'), 'utf-8'))).toEqual({
      shell: { command: '/repo/.bin/evil-shell' },
    })
    await expect(fs.access(`${path.join(managedDir, 'opencode.json')}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('leaves a managed config file without host-execution sections untouched', async () => {
    const managedDir = path.join(root, 'managed')
    process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = managedDir
    mkdirSync(managedDir, { recursive: true })
    writeFileSync(path.join(managedDir, 'opencode.json'), JSON.stringify({ model: 'x' }))
    writeConfig({})

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(path.join(managedDir, 'opencode.json'), 'utf-8'))).toEqual({ model: 'x' })
    await expect(fs.access(`${path.join(managedDir, 'opencode.json')}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('refuses an enforced quarantine when auth.json contains a well-known provider entry', async () => {
    const authDir = path.join(root, '.opencode', 'state', 'opencode')
    mkdirSync(authDir, { recursive: true })
    writeFileSync(
      path.join(authDir, 'auth.json'),
      JSON.stringify({ 'https://sso.example.com': { type: 'wellknown', key: 'SSO_TOKEN', token: 't' } }),
    )
    writeConfig({ plugin: ['evil-plugin'], model: 'x' })

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/well-known remote configuration/)
    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(/https:\/\/sso\.example\.com/)

    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ plugin: ['evil-plugin'], model: 'x' })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('allows api and oauth auth entries during an enforced quarantine', async () => {
    const authDir = path.join(root, '.opencode', 'state', 'opencode')
    mkdirSync(authDir, { recursive: true })
    writeFileSync(
      path.join(authDir, 'auth.json'),
      JSON.stringify({
        anthropic: { type: 'api', key: 'sk-test' },
        github: { type: 'oauth', refresh: 'r', access: 'a', expires: 1 },
      }),
    )
    writeConfig({ model: 'x' })

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
  })

  it('proceeds when auth.json is absent during an enforced quarantine', async () => {
    writeConfig({ model: 'x' })

    await quarantineOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
  })

  it('refuses an enforced quarantine when auth.json cannot be parsed', async () => {
    const authDir = path.join(root, '.opencode', 'state', 'opencode')
    mkdirSync(authDir, { recursive: true })
    writeFileSync(path.join(authDir, 'auth.json'), '{not json')
    writeConfig({ model: 'x' })

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(
      /cannot parse OpenCode auth file/,
    )
    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
  })

  it('refuses an enforced quarantine when auth.json cannot be read', async () => {
    const authDir = path.join(root, '.opencode', 'state', 'opencode')
    mkdirSync(authDir, { recursive: true })
    await fs.mkdir(path.join(authDir, 'auth.json'))
    writeConfig({ model: 'x' })

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(
      /cannot inspect OpenCode auth file/,
    )
    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
  })

  it('refuses an enforced quarantine when auth.json has an unexpected top-level shape', async () => {
    const authDir = path.join(root, '.opencode', 'state', 'opencode')
    mkdirSync(authDir, { recursive: true })
    writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify(['anthropic']))
    writeConfig({ model: 'x' })

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(
      /unexpected top-level shape/,
    )
  })

  it('refuses an enforced quarantine when an auth entry cannot be inspected', async () => {
    const authDir = path.join(root, '.opencode', 'state', 'opencode')
    mkdirSync(authDir, { recursive: true })
    writeFileSync(
      path.join(authDir, 'auth.json'),
      JSON.stringify({ anthropic: { type: 'api', key: 'sk-test' }, legacy: 'uninspectable' }),
    )
    writeConfig({ model: 'x' })

    await expect(quarantineOpenCodePlugins(configHome, configPath)).rejects.toThrow(
      /auth entry legacy in .* cannot be inspected/,
    )
  })
})
