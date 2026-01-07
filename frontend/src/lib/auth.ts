export const TOKEN_STORAGE_KEY = 'ocm_auth_token'

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken()
  if (token) {
    return { 'Authorization': `Bearer ${token}` }
  }
  return {}
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...getAuthHeaders(),
    ...options.headers,
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  })
  
  if (response.status === 401) {
    removeStoredToken()
    window.location.reload()
  }
  
  return response
}
