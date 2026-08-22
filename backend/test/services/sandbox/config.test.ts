import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCKED_SERVER_ENV_KEYS, DEFAULT_USER_PREFERENCES, UserPreferencesSchema } from '@opencode-manager/shared/schemas'

describe('settings schema - BLOCKED_SERVER_ENV_KEYS', () => {
  it('does not block config-source, auth-content, or test env keys', () => {
    const blocked = new Set<string>(BLOCKED_SERVER_ENV_KEYS)
    expect(blocked.has('OPENCODE_CONFIG_CONTENT')).toBe(false)
    expect(blocked.has('OPENCODE_CONFIG_DIR')).toBe(false)
    expect(blocked.has('OPENCODE_AUTH_CONTENT')).toBe(false)
    expect(blocked.has('OPENCODE_TEST_HOME')).toBe(false)
    expect(blocked.has('OPENCODE_TEST_MANAGED_CONFIG_DIR')).toBe(false)
    expect(blocked.has('SHELL')).toBe(false)
    expect(blocked.has('BASH_ENV')).toBe(false)
    expect(blocked.has('ENV')).toBe(false)
  })

  it('still blocks manager-owned password, username, config, and XDG keys', () => {
    const blocked = new Set<string>(BLOCKED_SERVER_ENV_KEYS)
    expect(blocked.has('OPENCODE_SERVER_PASSWORD')).toBe(true)
    expect(blocked.has('OPENCODE_SERVER_USERNAME')).toBe(true)
    expect(blocked.has('OPENCODE_CONFIG')).toBe(true)
    expect(blocked.has('XDG_DATA_HOME')).toBe(true)
    expect(blocked.has('XDG_STATE_HOME')).toBe(true)
    expect(blocked.has('XDG_CONFIG_HOME')).toBe(true)
  })
})

describe('sandbox config', () => {
  afterEach(() => {
    delete process.env.SANDBOX_IMAGE
  })

  it('defaults sandbox.enabled to false in the persisted preference contract', () => {
    const prefs = UserPreferencesSchema.parse(DEFAULT_USER_PREFERENCES)
    expect(prefs.sandbox?.enabled).toBe(false)
  })

  it('round-trips sandbox.enabled when set to true', () => {
    const prefs = UserPreferencesSchema.parse({
      ...DEFAULT_USER_PREFERENCES,
      sandbox: { enabled: true },
    })
    expect(prefs.sandbox).toEqual({ enabled: true })
  })

  it('falls back ENV.SANDBOX.IMAGE to the default when SANDBOX_IMAGE is unset', async () => {
    delete process.env.SANDBOX_IMAGE
    vi.resetModules()
    const { ENV } = await import('@opencode-manager/shared/config/env')
    const { DEFAULTS } = await import('@opencode-manager/shared/config/defaults')
    expect(ENV.SANDBOX.IMAGE).toBe(DEFAULTS.SANDBOX.IMAGE)
  })

  it('honors SANDBOX_IMAGE when set before module import', async () => {
    process.env.SANDBOX_IMAGE = 'node:22-alpine'
    vi.resetModules()
    const { ENV } = await import('@opencode-manager/shared/config/env')
    expect(ENV.SANDBOX.IMAGE).toBe('node:22-alpine')
  })
})
