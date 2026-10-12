import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E_ROOT = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(E2E_ROOT, '..')
export const E2E_TMP = path.join(E2E_ROOT, '.tmp')
export const STORAGE_STATE = path.join(E2E_TMP, 'storage-state.json')

export const BASE_URL = 'http://127.0.0.1:5013'
export const SERVER_PORT = 5013
export const OPENCODE_SERVER_PORT = 5561
export const PREVIEW_PORT = 5014

export const ADMIN_EMAIL = 'e2e-admin@example.com'
export const ADMIN_PASSWORD = 'e2e-admin-password'
export const AUTH_SECRET = 'e2e-playwright-auth-secret-0123456789'

function resolveOpenCodeBin(): string {
  const candidates = [
    process.env.OPENCODE_BIN,
    path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/opt/opencode/bin/opencode',
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate)) ?? 'opencode'
}

export function createServerEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    PORT: String(SERVER_PORT),
    HOST: '127.0.0.1',
    CORS_ORIGIN: BASE_URL,
    OPENCODE_SERVER_PORT: String(OPENCODE_SERVER_PORT),
    OPENCODE_HOST: '127.0.0.1',
    PREVIEW_PORT: String(PREVIEW_PORT),
    DATABASE_PATH: path.join(E2E_TMP, 'data', 'opencode-manager.db'),
    WORKSPACE_PATH: path.join(E2E_TMP, 'workspace'),
    REPO_BROWSE_ROOT: path.join(E2E_TMP, 'workspace'),
    AUTH_SECRET,
    AUTH_TRUSTED_ORIGINS: `${BASE_URL},http://localhost:${SERVER_PORT}`,
    AUTH_SECURE_COOKIES: 'false',
    PASSKEY_ORIGIN: BASE_URL,
    PASSKEY_RP_ID: '127.0.0.1',
    PASSKEY_RP_NAME: 'OpenCode Manager E2E',
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    HOME: path.join(E2E_TMP, 'home'),
    TMPDIR: path.join(E2E_TMP, 'tmp'),
    XDG_RUNTIME_DIR: path.join(E2E_TMP, 'run'),
    OPENCODE_BIN: resolveOpenCodeBin(),
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: '',
    VAPID_SUBJECT: '',
    DEBUG: 'false',
    LOG_LEVEL: 'error',
  }
}
