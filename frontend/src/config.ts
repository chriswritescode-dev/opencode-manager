export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001'
export const OPENCODE_API_ENDPOINT = import.meta.env.VITE_OPENCODE_PORT 
  ? `http://localhost:${import.meta.env.VITE_OPENCODE_PORT}`
  : 'http://localhost:5551'