export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

export const OPENCODE_API_ENDPOINT = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/api/opencode`
  : '/api/opencode'