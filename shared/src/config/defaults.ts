export const DEFAULTS = {
  SERVER: {
    PORT: 5003,
    HOST: '0.0.0.0',
    CORS_ORIGIN: 'http://localhost:5173',
  },

  FRONTEND: {
    PORT: 5173,
    HOST: '0.0.0.0',
  },

  OPENCODE: {
    PORT: 5551,
    HOST: '127.0.0.1',
  },

  DATABASE: {
    PATH: '', // Will be resolved to ~/.local/run/opencode-manager/opencode.db
  },

  WORKSPACE: {
    BASE_PATH: './workspace',
    REPOS_DIR: 'repos',
    CONFIG_DIR: '.config/opencode',
    AUTH_FILE: '.opencode/state/opencode/auth.json',
  },

  TIMEOUTS: {
    PROCESS_START_WAIT_MS: 2000,
    PROCESS_VERIFY_WAIT_MS: 1000,
    HEALTH_CHECK_INTERVAL_MS: 5000,
    HEALTH_CHECK_TIMEOUT_MS: 30000,
  },

  FILE_LIMITS: {
    MAX_SIZE_MB: 50,
    MAX_UPLOAD_SIZE_MB: 50,
  },

  LOGGING: {
    DEBUG: false,
    LOG_LEVEL: 'info',
  },
} as const

export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/html',
  'text/css',
  'text/javascript',
  'text/typescript',
  'application/json',
  'application/xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
] as const

export const GIT_PROVIDERS = {
  GITHUB: 'github.com',
  GITLAB: 'gitlab.com',
  BITBUCKET: 'bitbucket.org',
} as const

export type Config = typeof DEFAULTS
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]
export type GitProvider = (typeof GIT_PROVIDERS)[keyof typeof GIT_PROVIDERS]
