import { config } from 'dotenv'

config()

export const ENV = {
  PORT: parseInt(process.env.PORT || '5001'),
  OPENCODE_SERVER_PORT: parseInt(process.env.OPENCODE_SERVER_PORT || '5551'),
  HOST: process.env.HOST || '0.0.0.0',
  DATABASE_PATH: process.env.DATABASE_PATH || './data/opencode.db',
  WORKSPACE_PATH: process.env.WORKSPACE_PATH || '~/.opencode-workspace',
  PROCESS_START_WAIT_MS: parseInt(process.env.PROCESS_START_WAIT_MS || '2000'),
  PROCESS_VERIFY_WAIT_MS: parseInt(process.env.PROCESS_VERIFY_WAIT_MS || '1000'),
  HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '5000'),
  HEALTH_CHECK_TIMEOUT_MS: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '30000'),
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),
  MAX_UPLOAD_SIZE_MB: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50'),
  SANDBOX_TTL_HOURS: parseInt(process.env.SANDBOX_TTL_HOURS || '24'),
  CLEANUP_INTERVAL_MINUTES: parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '60'),
  DEBUG: process.env.DEBUG === 'true',
  VITE_API_URL: process.env.VITE_API_URL || 'http://localhost:5001',
  VITE_ANTHROPIC_API_KEY: process.env.VITE_ANTHROPIC_API_KEY || '',
  VITE_OPENAI_API_KEY: process.env.VITE_OPENAI_API_KEY || '',
  VITE_GOOGLE_API_KEY: process.env.VITE_GOOGLE_API_KEY || ''
}