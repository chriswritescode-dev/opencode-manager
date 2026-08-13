import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_PREFERENCES, UserPreferencesSchema } from '@opencode-manager/shared/schemas'

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
