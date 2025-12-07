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

export const oauthApi = {
  authorize: async (providerId: string, method: number): Promise<OAuthAuthorizeResponse> => {
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
        method,
      })
      return data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error || error.message
        throw new Error(`OAuth authorization failed: ${message}`)
      }
      throw error
    }
  },

  callback: async (providerId: string, request: OAuthCallbackRequest): Promise<boolean> => {
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, request)
      return data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error || error.message
        throw new Error(`OAuth callback failed: ${message}`)
      }
      throw error
    }
  },

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/oauth/auth-methods`)
      return data.providers || data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error || error.message
        throw new Error(`Failed to get provider auth methods: ${message}`)
      }
      throw error
    }
  },

  getTokenStatus: async (providerId: string): Promise<{
    hasCredentials: boolean
    isOAuth: boolean
    isExpired: boolean
  }> => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/oauth/${providerId}/token-status`)
      return data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error || error.message
        throw new Error(`Failed to get token status: ${message}`)
      }
      throw error
    }
  },
}