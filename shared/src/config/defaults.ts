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
    PUBLIC_URL: '', // Optional: public URL for OAuth callbacks (e.g., https://mydomain.com)
    HEALTH_WATCH_ENABLED: true,
    HEALTH_POLL_MS: 30000,
    HEALTH_FAILURE_THRESHOLD: 2,
  },

  DEV_PREVIEW: {
    PORT: 3056,
    PUBLIC_URL: '', // Optional: public origin for the preview iframe behind a reverse proxy (e.g., https://preview.mydomain.com)
  },

  DATABASE: {
    PATH: './data/opencode.db',
  },

  WORKSPACE: {
    BASE_PATH: './workspace',
    REPOS_DIR: 'repos',
    SCHEDULE_WORKTREES_DIR: 'schedule-worktrees',
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

  SSE: {
    RECONNECT_DELAY_MS: 1000,
    MAX_RECONNECT_DELAY_MS: 30000,
    CONNECT_TIMEOUT_MS: 10000,
    IDLE_GRACE_PERIOD_MS: 5000,
    HEARTBEAT_INTERVAL_MS: 30000,
    STALL_THRESHOLD_MS: 90000,
    WATCHDOG_TICK_MS: 15000,
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
  'text/markdown',
] as const

export const GIT_PROVIDERS = {
  GITHUB: 'github.com',
  GITLAB: 'gitlab.com',
  BITBUCKET: 'bitbucket.org',
} as const

export type Config = typeof DEFAULTS
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]
export type GitProvider = (typeof GIT_PROVIDERS)[keyof typeof GIT_PROVIDERS]
