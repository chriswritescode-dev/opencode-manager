import { API_BASE_URL } from "@/config"
import { fetchWrapper } from './fetchWrapper'

export interface OAuthAuthorizeResponse {
  url: string
  method: "code"
  instructions: string
}

export interface OAuthCallbackRequest {
  method: number
  code?: string
}

export interface ProviderAuthMethod {
  type: "oauth" | "api"
  label: string
}

export interface ProviderAuthMethods {
  [providerId: string]: ProviderAuthMethod[]
}

export const oauthApi = {
  authorize: async (providerId: string, method: number): Promise<OAuthAuthorizeResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    })
  },

  callback: async (providerId: string, request: OAuthCallbackRequest): Promise<boolean> => {
    return fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  },

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    const { providers, ...rest } = await fetchWrapper<{ providers?: ProviderAuthMethods } & ProviderAuthMethods>(
      `${API_BASE_URL}/api/oauth/auth-methods`
    )
    return providers || rest
  },
}
