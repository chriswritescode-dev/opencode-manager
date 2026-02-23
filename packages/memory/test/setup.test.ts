import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadPluginConfig, resolveConfigPath } from '../src/setup'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TEST_DIR = '/tmp/opencode-manager-memory-setup-test-' + Date.now()

describe('loadPluginConfig', () => {
  let testDir: string

  beforeEach(() => {
    testDir = TEST_DIR + '-' + Math.random().toString(36).slice(2)
    mkdirSync(testDir, { recursive: true })
    process.env['XDG_DATA_HOME'] = testDir
  })

  afterEach(() => {
    delete process.env['XDG_DATA_HOME']
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test('returns default config when no config file exists', () => {
    const config = loadPluginConfig()
    expect(config.embedding.provider).toBe('local')
    expect(config.embedding.model).toBe('all-MiniLM-L6-v2')
    expect(config.embedding.dimensions).toBe(384)
  })

  test('reads and parses valid config file', () => {
    const configPath = join(testDir, 'opencode', 'memory', 'config.json')
    mkdirSync(join(testDir, 'opencode', 'memory'), { recursive: true })

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
    const configPath = join(testDir, 'opencode', 'memory', 'config.json')
    mkdirSync(join(testDir, 'opencode', 'memory'), { recursive: true })

    writeFileSync(configPath, 'invalid json content')

    const config = loadPluginConfig()
    expect(config.embedding.provider).toBe('local')
  })

  test('returns defaults when file has wrong structure', () => {
    const configPath = join(testDir, 'opencode', 'memory', 'config.json')
    mkdirSync(join(testDir, 'opencode', 'memory'), { recursive: true })

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
})

describe('resolveConfigPath', () => {
  let testDir: string

  beforeEach(() => {
    testDir = TEST_DIR + '-' + Math.random().toString(36).slice(2)
  })

  afterEach(() => {
    delete process.env['XDG_DATA_HOME']
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test('returns correct path based on XDG_DATA_HOME', () => {
    process.env['XDG_DATA_HOME'] = testDir
    const configPath = resolveConfigPath()
    expect(configPath).toBe(join(testDir, 'opencode', 'memory', 'config.json'))
  })

  test('falls back to ~/.local/share when XDG_DATA_HOME is unset', () => {
    delete process.env['XDG_DATA_HOME']
    const configPath = resolveConfigPath()
    const expectedDefault = join(homedir(), '.local', 'share', 'opencode', 'memory', 'config.json')
    expect(configPath).toBe(expectedDefault)
  })
})
