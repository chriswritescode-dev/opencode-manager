import { ENV } from '@opencode-manager/shared/config/env'
import type { AuthEnv } from '../../src/auth'

export function createAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    ...ENV.AUTH,
    ADMIN_EMAIL: undefined,
    ADMIN_PASSWORD: undefined,
    ADMIN_PASSWORD_RESET: false,
    GITHUB_CLIENT_ID: undefined,
    GITHUB_CLIENT_SECRET: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    DISCORD_CLIENT_ID: undefined,
    DISCORD_CLIENT_SECRET: undefined,
    ...overrides,
  }
}
