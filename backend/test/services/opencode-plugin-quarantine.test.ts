import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { restoreQuarantinedOpenCodePlugins } from '../../src/services/opencode-plugin-quarantine'

describe('opencode plugin quarantine restore', () => {
  let root: string
  let configHome: string
  let configPath: string
  let homeDir: string
  let originalHome: string | undefined

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ocm-plugin-quarantine-'))
    configHome = path.join(root, '.config')
    configPath = path.join(configHome, 'opencode', 'opencode.json')
    homeDir = path.join(root, 'home')
    mkdirSync(path.join(configHome, 'opencode'), { recursive: true })
    originalHome = process.env.HOME
    process.env.HOME = homeDir
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

  function writeManifest(quarantineDir: string, entries: Record<string, { original: string; order: number | string }>) {
    writeFileSync(
      path.join(quarantineDir, '.ocm-quarantine-manifest.json'),
      JSON.stringify({ version: 1, entries }),
    )
  }

  it('restores legacy quarantined plugin entries into every plugin directory', async () => {
    mkdirSync(path.join(configHome, 'opencode', 'plugin.ocm-quarantine'), { recursive: true })
    mkdirSync(path.join(configHome, 'opencode', 'plugins.ocm-quarantine'), { recursive: true })
    mkdirSync(path.join(homeDir, '.opencode', 'plugin.ocm-quarantine'), { recursive: true })
    mkdirSync(path.join(homeDir, '.opencode', 'plugins.ocm-quarantine'), { recursive: true })
    writeFileSync(path.join(configHome, 'opencode', 'plugin.ocm-quarantine', 'user-plugin.js'), 'user code')
    writeFileSync(path.join(configHome, 'opencode', 'plugins.ocm-quarantine', 'extra.js'), 'extra code')
    writeFileSync(path.join(homeDir, '.opencode', 'plugin.ocm-quarantine', 'home-plugin.js'), 'home code')
    writeFileSync(path.join(homeDir, '.opencode', 'plugins.ocm-quarantine', 'global.js'), 'global code')
    writeManifest(path.join(configHome, 'opencode', 'plugin.ocm-quarantine'), {
      'user-plugin.js': { original: 'user-plugin.js', order: 1 },
    })
    writeManifest(path.join(configHome, 'opencode', 'plugins.ocm-quarantine'), {
      'extra.js': { original: 'extra.js', order: 1 },
    })
    writeManifest(path.join(homeDir, '.opencode', 'plugin.ocm-quarantine'), {
      'home-plugin.js': { original: 'home-plugin.js', order: 1 },
    })
    writeManifest(path.join(homeDir, '.opencode', 'plugins.ocm-quarantine'), {
      'global.js': { original: 'global.js', order: 1 },
    })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('user code')
    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugins', 'extra.js'), 'utf-8')).toBe('extra code')
    expect(
      await fs.readFile(path.join(homeDir, '.opencode', 'plugin', 'home-plugin.js'), 'utf-8'),
    ).toBe('home code')
    expect(await fs.readFile(path.join(homeDir, '.opencode', 'plugins', 'global.js'), 'utf-8')).toBe('global code')
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugin.ocm-quarantine'))).toEqual([])
    expect(await fs.readdir(path.join(configHome, 'opencode', 'plugins.ocm-quarantine'))).toEqual([])
    expect(await fs.readdir(path.join(homeDir, '.opencode', 'plugin.ocm-quarantine'))).toEqual([])
    expect(await fs.readdir(path.join(homeDir, '.opencode', 'plugins.ocm-quarantine'))).toEqual([])
  })

  it('restores a legacy quarantine without a manifest, preserving conflict copies only when their base exists', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'foo.js'), 'foo v1')
    writeFileSync(path.join(quarantineDir, 'foo.js.ocm-conflict1'), 'foo v2')
    writeFileSync(path.join(quarantineDir, 'audit.ocm-conflict1'), 'legit legacy file')

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'foo.js'), 'utf-8')).toBe('foo v1')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'audit.ocm-conflict1'), 'utf-8'),
    ).toBe('legit legacy file')
    expect(await fs.readdir(quarantineDir)).toEqual(['foo.js.ocm-conflict1'])
  })

  it('keeps the original quarantine copy and leaves later collisions recoverable', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'v1')
    writeFileSync(path.join(quarantineDir, 'user-plugin.js.ocm-conflict1'), 'v2')
    writeManifest(quarantineDir, {
      'user-plugin.js': { original: 'user-plugin.js', order: 1 },
      'user-plugin.js.ocm-conflict1': { original: 'user-plugin.js', order: 2 },
    })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('v1')
    expect(
      await fs.readFile(path.join(quarantineDir, 'user-plugin.js.ocm-conflict1'), 'utf-8'),
    ).toBe('v2')
  })

  it('ignores a malicious quarantine manifest path that escapes the plugin directory during restore', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'v1')
    writeManifest(quarantineDir, {
      'user-plugin.js': { original: '../../escaped-target', order: 1 },
    })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    await expect(fs.access(path.join(root, 'escaped-target'))).rejects.toThrow()
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('v1')
    expect(await fs.readdir(quarantineDir)).toEqual([])
  })

  it('restores safely when the quarantine manifest contains a traversal key and a non-numeric order', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'v1')
    writeFileSync(path.join(quarantineDir, 'other.js'), 'v2')
    writeManifest(quarantineDir, {
      '../../evil.js': { original: 'user-plugin.js', order: 1 },
      'other.js': { original: 'other.js', order: 'not-a-number' },
    })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8')).toBe('v1')
    expect(await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'other.js'), 'utf-8')).toBe('v2')
    await expect(fs.access(path.join(root, 'evil.js'))).rejects.toThrow()
    expect(await fs.readdir(quarantineDir)).toEqual([])
  })

  it('rejects a restore through a symlinked plugin directory without touching the symlink target', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'v1')
    writeManifest(quarantineDir, {
      'user-plugin.js': { original: 'user-plugin.js', order: 1 },
    })

    const externalTarget = path.join(root, 'external-active')
    mkdirSync(externalTarget, { recursive: true })
    writeFileSync(path.join(externalTarget, 'marker.js'), 'marker')
    await fs.symlink(externalTarget, path.join(configHome, 'opencode', 'plugin'))

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/symbolic link/)

    expect(await fs.readdir(externalTarget)).toEqual(['marker.js'])
    expect(
      await fs.readFile(path.join(quarantineDir, 'user-plugin.js'), 'utf-8'),
    ).toBe('v1')
  })

  it('rejects a restore when the quarantine directory itself is a symlink', async () => {
    const externalTarget = path.join(root, 'external-quarantine')
    mkdirSync(externalTarget, { recursive: true })
    mkdirSync(path.join(configHome, 'opencode', 'plugin'), { recursive: true })
    writeFileSync(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'user code')
    await fs.symlink(externalTarget, path.join(configHome, 'opencode', 'plugin.ocm-quarantine'))

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/symbolic link/)

    expect(await fs.readdir(externalTarget)).toEqual([])
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8'),
    ).toBe('user code')
  })

  it('restores host-execution sections from a legacy .ocm-sandbox-backup and removes the backup', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(
      `${configPath}.ocm-sandbox-backup`,
      JSON.stringify({
        removedSections: {
          plugin: ['my-plugin'],
          shell: { command: '/repo/.bin/evil-shell', args: [] },
          mcp: { local: { type: 'local', command: ['node', 'server.js'] } },
        },
      }),
    )

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['my-plugin'])
    expect(restored.shell).toEqual({ command: '/repo/.bin/evil-shell', args: [] })
    expect(restored.mcp).toEqual({ local: { type: 'local', command: ['node', 'server.js'] } })
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('accepts a legacy backup that recorded an empty plugin list', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(`${configPath}.ocm-sandbox-backup`, JSON.stringify({ originalPlugins: [] }))

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).resolves.toBeUndefined()

    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('restores plugins recorded in a legacy originalPlugins backup', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(`${configPath}.ocm-sandbox-backup`, JSON.stringify({ originalPlugins: ['legacy-plugin'] }))

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['legacy-plugin'])
    expect(restored.model).toBe('x')
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('does not overwrite a same-name remote MCP server added while enforcement was active', async () => {
    writeConfig({ mcp: { build: { type: 'remote', url: 'https://example.com/mcp' } } })
    writeFileSync(
      `${configPath}.ocm-sandbox-backup`,
      JSON.stringify({
        removedSections: { mcp: { build: { type: 'local', command: ['node', 'build.js'] } } },
      }),
    )

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.mcp).toEqual({ build: { type: 'remote', url: 'https://example.com/mcp' } })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('restores legacy backups from every native global config file alongside the manager config', async () => {
    const jsoncPath = path.join(configHome, 'opencode', 'opencode.jsonc')
    const homeJsonPath = path.join(homeDir, '.opencode', 'opencode.json')
    mkdirSync(path.dirname(homeJsonPath), { recursive: true })
    writeFileSync(jsoncPath, JSON.stringify({ model: 'x' }))
    writeFileSync(homeJsonPath, JSON.stringify({ lsp: true }))
    writeFileSync(`${jsoncPath}.ocm-sandbox-backup`, JSON.stringify({ removedSections: { plugin: ['evil-plugin'] } }))
    writeFileSync(
      `${homeJsonPath}.ocm-sandbox-backup`,
      JSON.stringify({ removedSections: { shell: { command: '/repo/.bin/evil-shell' } } }),
    )

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(jsoncPath, 'utf-8'))).toEqual({ plugin: ['evil-plugin'], model: 'x' })
    expect(JSON.parse(await fs.readFile(homeJsonPath, 'utf-8'))).toEqual({
      shell: { command: '/repo/.bin/evil-shell' },
      lsp: true,
    })
    await expect(fs.access(`${jsoncPath}.ocm-sandbox-backup`)).rejects.toThrow()
    await expect(fs.access(`${homeJsonPath}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('restores managed config files from the system managed config directory', async () => {
    const managedDir = path.join(root, 'managed')
    process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = managedDir
    mkdirSync(managedDir, { recursive: true })
    writeFileSync(path.join(managedDir, 'opencode.json'), JSON.stringify({ model: 'x' }))
    writeFileSync(
      `${path.join(managedDir, 'opencode.json')}.ocm-sandbox-backup`,
      JSON.stringify({ removedSections: { plugin: ['evil-plugin'] } }),
    )

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(path.join(managedDir, 'opencode.json'), 'utf-8'))).toEqual({
      plugin: ['evil-plugin'],
      model: 'x',
    })
    await expect(fs.access(`${path.join(managedDir, 'opencode.json')}.ocm-sandbox-backup`)).rejects.toThrow()
  })

  it('does not create new quarantine or backup artifacts when nothing is quarantined', async () => {
    writeConfig({ model: 'x' })

    await restoreQuarantinedOpenCodePlugins(configHome, configPath)

    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).rejects.toThrow()
    expect(
      await fs.access(path.join(configHome, 'opencode', 'plugin.ocm-quarantine')).then(() => true).catch(() => false),
    ).toBe(false)
  })

  it('keeps the backup until the restored config replacement succeeds', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(`${configPath}.ocm-sandbox-backup`, JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }))

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

  it('rejects a quarantine restore when the manifest is malformed JSON', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'user code')
    writeFileSync(path.join(quarantineDir, '.ocm-quarantine-manifest.json'), '{ not json')

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/not valid JSON/)

    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin.js'), 'utf-8')).toBe('user code')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8').then(() => true).catch(() => false),
    ).toBe(false)
  })

  it('rejects a quarantine restore when the manifest cannot be read', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'user code')
    writeFileSync(path.join(quarantineDir, '.ocm-quarantine-manifest.json'), JSON.stringify({ version: 1, entries: {} }))

    const readSpy = vi.spyOn(fs, 'readFile')
    readSpy.mockImplementationOnce(async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })

    try {
      await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/cannot read quarantine manifest/)
    } finally {
      readSpy.mockRestore()
    }

    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin.js'), 'utf-8')).toBe('user code')
  })

  it('rejects a restore when the legacy backup is malformed and keeps the backup', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(`${configPath}.ocm-sandbox-backup`, '{ not json')

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/cannot parse legacy backup/)

    expect(JSON.parse(await fs.readFile(configPath, 'utf-8'))).toEqual({ model: 'x' })
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()
  })

  it('rejects a restore when the current config cannot be read alongside a legacy backup', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(`${configPath}.ocm-sandbox-backup`, JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }))

    const readSpy = vi.spyOn(fs, 'readFile')
    let backupReads = 0
    readSpy.mockImplementation(async (filePath: unknown) => {
      if (String(filePath).endsWith('.ocm-sandbox-backup')) {
        backupReads += 1
        return JSON.stringify({ removedSections: { plugin: ['my-plugin'] } })
      }
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })

    try {
      await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/cannot read config/)
      expect(backupReads).toBe(1)
    } finally {
      readSpy.mockRestore()
    }

    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()
  })

  it('rejects a restore when the current config is malformed alongside a legacy backup', async () => {
    writeFileSync(configPath, '{ not json')
    writeFileSync(`${configPath}.ocm-sandbox-backup`, JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }))

    await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow(/cannot parse config/)

    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()
  })

  it('propagates a failed plugin entry restore and leaves the quarantine intact', async () => {
    const quarantineDir = path.join(configHome, 'opencode', 'plugin.ocm-quarantine')
    mkdirSync(quarantineDir, { recursive: true })
    writeFileSync(path.join(quarantineDir, 'user-plugin.js'), 'v1')
    writeManifest(quarantineDir, {
      'user-plugin.js': { original: 'user-plugin.js', order: 1 },
    })

    const renameSpy = vi.spyOn(fs, 'rename')
    renameSpy.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })

    try {
      await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow('disk full')
    } finally {
      renameSpy.mockRestore()
    }

    expect(await fs.readFile(path.join(quarantineDir, 'user-plugin.js'), 'utf-8')).toBe('v1')
    expect(
      await fs.readFile(path.join(configHome, 'opencode', 'plugin', 'user-plugin.js'), 'utf-8').then(() => true).catch(() => false),
    ).toBe(false)
    expect(await fs.readdir(quarantineDir)).toContain('.ocm-quarantine-manifest.json')
  })

  it('propagates a failed backup removal after a successful restore', async () => {
    writeConfig({ model: 'x' })
    writeFileSync(`${configPath}.ocm-sandbox-backup`, JSON.stringify({ removedSections: { plugin: ['my-plugin'] } }))

    const rmSpy = vi.spyOn(fs, 'rm')
    rmSpy.mockImplementationOnce(async () => {
      throw new Error('cannot remove')
    })

    try {
      await expect(restoreQuarantinedOpenCodePlugins(configHome, configPath)).rejects.toThrow('cannot remove')
    } finally {
      rmSpy.mockRestore()
    }

    const restored = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>
    expect(restored.plugin).toEqual(['my-plugin'])
    await expect(fs.access(`${configPath}.ocm-sandbox-backup`)).resolves.toBeUndefined()
  })
})
