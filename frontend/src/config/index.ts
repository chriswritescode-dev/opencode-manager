import { createClientConfig, DEFAULTS, ALLOWED_MIME_TYPES, GIT_PROVIDERS } from '../../../shared/src/config/client'

const config = createClientConfig({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_SERVER_PORT: import.meta.env.VITE_SERVER_PORT,
  VITE_OPENCODE_PORT: import.meta.env.VITE_OPENCODE_PORT,
  VITE_MAX_FILE_SIZE_MB: import.meta.env.VITE_MAX_FILE_SIZE_MB,
  VITE_MAX_UPLOAD_SIZE_MB: import.meta.env.VITE_MAX_UPLOAD_SIZE_MB,
})

// Fix for Cloudflare Access / Basic Auth URLs:
let apiBaseUrl = config.API_BASE_URL

if (typeof window !== 'undefined' && !apiBaseUrl) {
  // Construct origin manually to be safe
  apiBaseUrl = `${window.location.protocol}//${window.location.host}`
  console.log('[Config] Resolved API_BASE_URL from window:', apiBaseUrl)
}

export const API_BASE_URL = apiBaseUrl
export const OPENCODE_API_ENDPOINT = `${apiBaseUrl}/api/opencode`
export const SERVER_PORT = config.SERVER_PORT
export const OPENCODE_PORT = config.OPENCODE_PORT
export const FILE_LIMITS = config.FILE_LIMITS

export { DEFAULTS, ALLOWED_MIME_TYPES, GIT_PROVIDERS }
export default config
