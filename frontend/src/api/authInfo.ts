import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enabledProviders: ['credentials'],
  registrationEnabled: true,
  isFirstUser: false,
  adminConfigured: false,
}

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    return await fetchWrapper<AuthConfig>(`${API_BASE_URL}/api/auth-info/config`)
  } catch {
    return DEFAULT_AUTH_CONFIG
  }
}

export interface Passkey {
  id: string
  name?: string
  credentialID: string
  createdAt: string
  deviceType: string
}

export async function listUserPasskeys(): Promise<Passkey[]> {
  try {
    return await fetchWrapper<Passkey[]>(`${API_BASE_URL}/api/auth/passkey/list-user-passkeys`)
  } catch {
    return []
  }
}
