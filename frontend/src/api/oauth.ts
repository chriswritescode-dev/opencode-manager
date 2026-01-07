import axios from "axios"
import { API_BASE_URL } from "@/config"

export interface OAuthAuthorizeResponse {
  url: string
  method: "auto" | "code"
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
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error || error.message
    throw new Error(`${context}: ${message}`)
  }
  throw error
}

export const oauthApi = {
  authorize: async (providerId: string, method: number): Promise<OAuthAuthorizeResponse> => {
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
        method,
      })
      return data
    } catch (error) {
      handleApiError(error, "OAuth authorization failed")
    }
  },

  callback: async (providerId: string, request: OAuthCallbackRequest): Promise<boolean> => {
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, request)
      return data
    } catch (error) {
      handleApiError(error, "OAuth callback failed")
    }
  },

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/oauth/auth-methods`)
      return data.providers || data
    } catch (error) {
      handleApiError(error, "Failed to get provider auth methods")
    }
  },
}
