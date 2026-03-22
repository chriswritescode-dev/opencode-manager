import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadPluginConfig, resolveConfigPath } from '../src/setup'
import { mkdirSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TEST_DIR = '/tmp/opencode-manager-memory-setup-test-' + Date.now()

describe('loadPluginConfig', () => {
  let testConfigDir: string
  let testDataDir: string

  beforeEach(() => {
    testConfigDir = TEST_DIR + '-config-' + Math.random().toString(36).slice(2)
    testDataDir = TEST_DIR + '-data-' + Math.random().toString(36).slice(2)
    mkdirSync(testConfigDir, { recursive: true })
    mkdirSync(testDataDir, { recursive: true })
    process.env['XDG_CONFIG_HOME'] = testConfigDir
    process.env['XDG_DATA_HOME'] = testDataDir
  })

  afterEach(() => {
    delete process.env['XDG_CONFIG_HOME']
    delete process.env['XDG_DATA_HOME']
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true })
    }
  })

  test('returns default config when no config file exists', () => {
    const config = loadPluginConfig()
    expect(config.embedding.provider).toBe('local')
    expect(config.embedding.model).toBe('all-MiniLM-L6-v2')
    expect(config.embedding.dimensions).toBe(384)
  })

  test('reads and parses valid config file', () => {
    const configPath = join(testConfigDir, 'opencode', 'memory-config.jsonc')
    mkdirSync(join(testConfigDir, 'opencode'), { recursive: true })

    const validConfig = {
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        apiKey: 'sk-test123',
        baseUrl: 'https://api.openai.com/v1',
      },
      dedupThreshold: 0.3,
    }

    writeFileSync(configPath, JSON.stringify(validConfig))

    const config = loadPluginConfig()
    expect(config.embedding.provider).toBe('openai')
    expect(config.embedding.model).toBe('text-embedding-3-small')
    expect(config.embedding.dimensions).toBe(1536)
    expect(config.embedding.apiKey).toBe('sk-test123')
    expect(config.dedupThreshold).toBe(0.3)
  })

  test('returns defaults when file contains invalid JSON', () => {
    const configPath = join(testConfigDir, 'opencode', 'memory-config.jsonc')
    mkdirSync(join(testConfigDir, 'opencode'), { recursive: true })

    writeFileSync(configPath, 'invalid json content')

    const config = loadPluginConfig()
    expect(config.embedding.provider).toBe('local')
  })

  test('returns defaults when file has wrong structure', () => {
    const configPath = join(testConfigDir, 'opencode', 'memory-config.jsonc')
    mkdirSync(join(testConfigDir, 'opencode'), { recursive: true })

    const invalidConfig = {
      embedding: {
        provider: 'invalid-provider',
        model: 'some-model',
      },
      dedupThreshold: 'not-a-number',
    }

    writeFileSync(configPath, JSON.stringify(invalidConfig))

    const config = loadPluginConfig()
    expect(config.embedding.provider).toBe('local')
  })

  test('migrates config from old data dir location to new config dir location', () => {
    const oldConfigPath = join(testDataDir, 'opencode', 'memory', 'config.json')
    const newConfigPath = join(testConfigDir, 'opencode', 'memory-config.jsonc')
    
    mkdirSync(join(testDataDir, 'opencode', 'memory'), { recursive: true })

    const oldConfig = {
      embedding: {
        provider: 'voyage',
        model: 'voyage-code-3',
        dimensions: 1024,
      },
      dedupThreshold: 0.35,
    }

    writeFileSync(oldConfigPath, JSON.stringify(oldConfig))

    const config = loadPluginConfig()
    
    expect(config.embedding.provider).toBe('voyage')
    expect(config.embedding.model).toBe('voyage-code-3')
    expect(config.dedupThreshold).toBe(0.35)
    
    expect(existsSync(newConfigPath)).toBe(true)
  })
})

describe('resolveConfigPath', () => {
  let testConfigDir: string

  beforeEach(() => {
    testConfigDir = TEST_DIR + '-configpath-' + Math.random().toString(36).slice(2)
    mkdirSync(testConfigDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env['XDG_CONFIG_HOME']
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true })
    }
  })

  test('returns correct path based on XDG_CONFIG_HOME', () => {
    process.env['XDG_CONFIG_HOME'] = testConfigDir
    const configPath = resolveConfigPath()
    expect(configPath).toBe(join(testConfigDir, 'opencode', 'memory-config.jsonc'))
  })

  test('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    delete process.env['XDG_CONFIG_HOME']
    const configPath = resolveConfigPath()
    const expectedDefault = join(homedir(), '.config', 'opencode', 'memory-config.jsonc')
    expect(configPath).toBe(expectedDefault)
  })
})
