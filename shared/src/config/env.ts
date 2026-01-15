import path from 'path'
import os from 'os'
import { DEFAULTS } from './defaults'

try {
  const { config } = await import('dotenv')
  config({ path: path.resolve(process.cwd(), '.env') })
} catch {
  // dotenv not available (e.g., in production Docker), env vars already set
}

const getEnvString = (key: string, defaultValue: string): string => {
  return process.env[key] ?? defaultValue
}

const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key]
  return value ? parseInt(value, 10) : defaultValue
}

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key]
  if (value === undefined) return defaultValue
  return value === 'true' || value === '1'
}

const resolveWorkspacePath = (): string => {
  const envPath = process.env.WORKSPACE_PATH
  if (envPath) {
    if (envPath.startsWith('~')) {
      return path.join(os.homedir(), envPath.slice(1))
    }
    return path.resolve(envPath)
  }
  return path.resolve(DEFAULTS.WORKSPACE.BASE_PATH)
}

const workspaceBasePath = resolveWorkspacePath()

export const ENV = {
  SERVER: {
    PORT: getEnvNumber('PORT', DEFAULTS.SERVER.PORT),
    HOST: getEnvString('HOST', DEFAULTS.SERVER.HOST),
    CORS_ORIGIN: getEnvString('CORS_ORIGIN', DEFAULTS.SERVER.CORS_ORIGIN),
    NODE_ENV: getEnvString('NODE_ENV', 'development'),
  },

  OPENCODE: {
    PORT: getEnvNumber('OPENCODE_SERVER_PORT', DEFAULTS.OPENCODE.PORT),
    HOST: getEnvString('OPENCODE_HOST', DEFAULTS.OPENCODE.HOST),
  },

  DATABASE: {
    PATH: getEnvString('DATABASE_PATH', DEFAULTS.DATABASE.PATH),
  },

  WORKSPACE: {
    BASE_PATH: workspaceBasePath,
    REPOS_DIR: DEFAULTS.WORKSPACE.REPOS_DIR,
    CONFIG_DIR: DEFAULTS.WORKSPACE.CONFIG_DIR,
    AUTH_FILE: DEFAULTS.WORKSPACE.AUTH_FILE,
  },

  TIMEOUTS: {
    PROCESS_START_WAIT_MS: getEnvNumber('PROCESS_START_WAIT_MS', DEFAULTS.TIMEOUTS.PROCESS_START_WAIT_MS),
    PROCESS_VERIFY_WAIT_MS: getEnvNumber('PROCESS_VERIFY_WAIT_MS', DEFAULTS.TIMEOUTS.PROCESS_VERIFY_WAIT_MS),
    HEALTH_CHECK_INTERVAL_MS: getEnvNumber('HEALTH_CHECK_INTERVAL_MS', DEFAULTS.TIMEOUTS.HEALTH_CHECK_INTERVAL_MS),
    HEALTH_CHECK_TIMEOUT_MS: getEnvNumber('HEALTH_CHECK_TIMEOUT_MS', DEFAULTS.TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS),
  },

  FILE_LIMITS: {
    MAX_SIZE_BYTES: getEnvNumber('MAX_FILE_SIZE_MB', DEFAULTS.FILE_LIMITS.MAX_SIZE_MB) * 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: getEnvNumber('MAX_UPLOAD_SIZE_MB', DEFAULTS.FILE_LIMITS.MAX_UPLOAD_SIZE_MB) * 1024 * 1024,
  },

  LOGGING: {
    DEBUG: getEnvBoolean('DEBUG', DEFAULTS.LOGGING.DEBUG),
    LOG_LEVEL: getEnvString('LOG_LEVEL', DEFAULTS.LOGGING.LOG_LEVEL),
  },
} as const

export const getWorkspacePath = () => ENV.WORKSPACE.BASE_PATH
export const getReposPath = () => path.join(ENV.WORKSPACE.BASE_PATH, ENV.WORKSPACE.REPOS_DIR)
export const getConfigPath = () => path.join(ENV.WORKSPACE.BASE_PATH, ENV.WORKSPACE.CONFIG_DIR)
export const getOpenCodeConfigFilePath = () => path.join(ENV.WORKSPACE.BASE_PATH, ENV.WORKSPACE.CONFIG_DIR, 'opencode.json')
export const getAgentsMdPath = () => path.join(ENV.WORKSPACE.BASE_PATH, ENV.WORKSPACE.CONFIG_DIR, 'AGENTS.md')
export const getAuthPath = () => path.join(ENV.WORKSPACE.BASE_PATH, ENV.WORKSPACE.AUTH_FILE)
export const getDatabasePath = () => ENV.DATABASE.PATH

export const getApiUrl = (port: number = ENV.SERVER.PORT): string => {
  const host = ENV.SERVER.HOST
  
  if (host === '0.0.0.0') {
    const interfaces = os.networkInterfaces()
    const ips = Object.values(interfaces)
      .flat()
      .filter(info => info && !info.internal && info.family === 'IPv4')
      .map(info => info!.address)
    
    if (ips.length > 0) {
      return `http://${ips[0]}:${port}`
    }
    
    return `http://localhost:${port}`
  }
  
  return `http://${host}:${port}`
}

export const SERVER_CONFIG = ENV.SERVER
export const OPENCODE_CONFIG = ENV.OPENCODE
export const FILE_LIMITS = ENV.FILE_LIMITS
export const TIMEOUTS = ENV.TIMEOUTS
export const WORKSPACE = ENV.WORKSPACE
