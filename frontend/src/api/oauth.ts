import { API_BASE_URL } from "@/config"
import { fetchWrapper, FetchError } from "./fetchWrapper"

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

function handleApiError(error: unknown, context: string): never {
  if (error instanceof FetchError) {
    throw new Error(`${context}: ${error.message}`)
  }
  throw error
}

export const oauthApi = {
  authorize: async (providerId: string, method: number): Promise<OAuthAuthorizeResponse> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      })
    } catch (error) {
      handleApiError(error, "OAuth authorization failed")
    }
  },

  callback: async (providerId: string, request: OAuthCallbackRequest): Promise<boolean> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
    } catch (error) {
      handleApiError(error, "OAuth callback failed")
    }
  },

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    try {
      const { providers, ...rest } = await fetchWrapper<{ providers?: ProviderAuthMethods } & ProviderAuthMethods>(
        `${API_BASE_URL}/api/oauth/auth-methods`
      )
      return providers || rest
    } catch (error) {
      handleApiError(error, "Failed to get provider auth methods")
    }
  },
}
