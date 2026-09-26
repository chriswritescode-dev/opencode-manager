import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addPluginToCliConfig,
  InstallError,
  installVendoredOcm,
  OCM_PLUGIN_SPEC,
  resolveOpenCodeConfigDir,
  resolveVendorPaths,
} from '../src/vendor-install.js'

let root: string
let sourceDist: string
let configDir: string
let home: string

function makeSourceDist(): string {
  const dir = join(root, 'source', 'dist')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ocm.js'), '#!/usr/bin/env node\n', { mode: 0o644 })
  writeFileSync(join(dir, 'tui.js'), 'export const setup = () => {}\n')
  writeFileSync(join(root, 'source', 'package.json'), '{"name":"@opencode-manager/ocm-cli"}')
  writeFileSync(join(root, 'source', 'README.md'), '# ocm-cli')
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ocm-vendor-'))
  sourceDist = makeSourceDist()
  configDir = join(root, 'config', 'opencode')
  home = join(root, 'home')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveOpenCodeConfigDir', () => {
  it('defaults to ~/.config/opencode', () => {
    expect(resolveOpenCodeConfigDir({}, '/Users/me')).toBe('/Users/me/.config/opencode')
  })

  it('honours XDG_CONFIG_HOME', () => {
    expect(resolveOpenCodeConfigDir({ XDG_CONFIG_HOME: '/xdg' }, '/Users/me')).toBe('/xdg/opencode')
  })

  it('prefers OPENCODE_CONFIG_DIR', () => {
    expect(resolveOpenCodeConfigDir({ OPENCODE_CONFIG_DIR: '/custom', XDG_CONFIG_HOME: '/xdg' }, '/Users/me')).toBe('/custom')
  })
})

describe('addPluginToCliConfig', () => {
  it('creates a config with the schema and plugin entry', () => {
    const result = addPluginToCliConfig(null)
    expect(result.changed).toBe(true)
    expect(JSON.parse(result.text)).toEqual({
      $schema: 'https://opencode.ai/v2/cli.json',
      plugins: [OCM_PLUGIN_SPEC],
    })
  })

  it('appends to an existing plugins array', () => {
    const result = addPluginToCliConfig(JSON.stringify({ plugins: ['other'] }, null, 2))
    expect(result.changed).toBe(true)
    expect(JSON.parse(result.text).plugins).toEqual(['other', OCM_PLUGIN_SPEC])
  })

  it('adds a plugins array to a config without one', () => {
    const result = addPluginToCliConfig(JSON.stringify({ theme: { name: 'tokyonight' } }, null, 2))
    expect(result.changed).toBe(true)
    expect(JSON.parse(result.text)).toEqual({ theme: { name: 'tokyonight' }, plugins: [OCM_PLUGIN_SPEC] })
  })

  it('is idempotent for string and tuple entries', () => {
    expect(addPluginToCliConfig(JSON.stringify({ plugins: [OCM_PLUGIN_SPEC] })).changed).toBe(false)
    expect(addPluginToCliConfig(JSON.stringify({ plugins: [[OCM_PLUGIN_SPEC, {}]] })).changed).toBe(false)
  })

  it('preserves comments and other settings', () => {
    const text = `{\n  // keep\n  "theme": { "name": "tokyonight" },\n  "plugins": ["other"]\n}\n`
    const result = addPluginToCliConfig(text)
    expect(result.text).toContain('// keep')
    expect(result.text).toContain('"tokyonight"')
    expect(result.text).toContain(OCM_PLUGIN_SPEC)
  })

  it('rejects invalid json and non-array plugins', () => {
    expect(() => addPluginToCliConfig('{ not json')).toThrow(InstallError)
    expect(() => addPluginToCliConfig(JSON.stringify({ plugins: 'nope' }))).toThrow(InstallError)
  })
})

describe('installVendoredOcm', () => {
  it('copies the package, registers the plugin, and links the binary', () => {
    const result = installVendoredOcm({ sourceDistDir: sourceDist, configDir, home })

    expect(result.copied).toEqual(['dist', 'package.json', 'README.md'])
    expect(existsSync(join(result.pluginDir, 'dist', 'ocm.js'))).toBe(true)
    expect(existsSync(join(result.pluginDir, 'dist', 'tui.js'))).toBe(true)
    expect(existsSync(join(result.pluginDir, 'package.json'))).toBe(true)
    expect(result.configChanged).toBe(true)
    expect(JSON.parse(readFileSync(result.configFile, 'utf-8')).plugins).toEqual([OCM_PLUGIN_SPEC])
    expect(result.binLinkChanged).toBe(true)
    expect(lstatSync(result.binLink!).isSymbolicLink()).toBe(true)
    expect(readlinkSync(result.binLink!)).toBe(join(result.pluginDir, 'dist', 'ocm.js'))
  })

  it('is idempotent on a second run', () => {
    installVendoredOcm({ sourceDistDir: sourceDist, configDir, home })
    const second = installVendoredOcm({ sourceDistDir: sourceDist, configDir, home })

    expect(second.copied).toEqual(['dist', 'package.json', 'README.md'])
    expect(second.configChanged).toBe(false)
    expect(second.binLinkChanged).toBe(false)
    expect(JSON.parse(readFileSync(second.configFile, 'utf-8')).plugins).toEqual([OCM_PLUGIN_SPEC])
  })

  it('keeps an existing cli.json plugin list and settings', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'cli.json'), JSON.stringify({ theme: { name: 'tokyonight' }, plugins: ['other'] }))

    installVendoredOcm({ sourceDistDir: sourceDist, configDir, home })

    const config = JSON.parse(readFileSync(join(configDir, 'cli.json'), 'utf-8'))
    expect(config.theme).toEqual({ name: 'tokyonight' })
    expect(config.plugins).toEqual(['other', OCM_PLUGIN_SPEC])
  })

  it('leaves the source untouched when the plugin dir is a symlink to it', () => {
    mkdirSync(join(configDir, 'plugin'), { recursive: true })
    symlinkSync(join(root, 'source'), join(configDir, 'plugin', 'ocm-cli'))

    const result = installVendoredOcm({ sourceDistDir: sourceDist, configDir, home, link: false })

    expect(result.copied).toEqual([])
    expect(existsSync(join(sourceDist, 'ocm.js'))).toBe(true)
    expect(existsSync(join(root, 'source', 'package.json'))).toBe(true)
  })

  it('rejects a missing package build', () => {
    expect(() => installVendoredOcm({ sourceDistDir: join(root, 'nope'), configDir, home })).toThrow(InstallError)
  })

  it('refuses to overwrite a non-symlink binary without force', () => {
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(join(home, '.local', 'bin', 'ocm'), '#!/bin/sh\n')

    expect(() => installVendoredOcm({ sourceDistDir: sourceDist, configDir, home })).toThrow(InstallError)

    const forced = installVendoredOcm({ sourceDistDir: sourceDist, configDir, home, force: true })
    expect(forced.binLinkChanged).toBe(true)
    expect(lstatSync(forced.binLink!).isSymbolicLink()).toBe(true)
  })

  it('skips the binary link when disabled', () => {
    const result = installVendoredOcm({ sourceDistDir: sourceDist, configDir, home, link: false })
    expect(result.binLink).toBeNull()
    expect(existsSync(join(home, '.local', 'bin', 'ocm'))).toBe(false)
  })

  it('does not delete the running vendored install when re-run from it', () => {
    installVendoredOcm({ sourceDistDir: sourceDist, configDir, home })
    const vendoredDist = join(resolveVendorPaths(configDir, home).pluginDistDir)

    const result = installVendoredOcm({ sourceDistDir: vendoredDist, configDir, home, link: false })

    expect(result.copied).toEqual([])
    expect(existsSync(join(vendoredDist, 'ocm.js'))).toBe(true)
  })
})
