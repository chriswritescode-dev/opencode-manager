import { API_BASE_URL } from "@/config"
import type { components, operations } from "./opencode-types"
import { fetchWrapper } from "./fetchWrapper"

type OpenCodeAuthorizeRequest = NonNullable<operations["provider.oauth.authorize"]["requestBody"]>["content"]["application/json"]

export type OAuthAuthorizeResponse = components["schemas"]["ProviderAuthAuthorization"]

export type OAuthCallbackRequest = NonNullable<operations["provider.oauth.callback"]["requestBody"]>["content"]["application/json"]

export type ProviderAuthMethod = components["schemas"]["ProviderAuthMethod"]

export interface ProviderAuthMethods {
  [providerId: string]: ProviderAuthMethod[]
}

export const oauthApi = {
  authorize: async (providerId: string, method: number, inputs?: OpenCodeAuthorizeRequest["inputs"]): Promise<OAuthAuthorizeResponse> =>
    fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, inputs }),
    }),

  callback: async (providerId: string, request: OAuthCallbackRequest): Promise<boolean> =>
    fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    const { providers, ...rest } = await fetchWrapper<{ providers?: ProviderAuthMethods } & ProviderAuthMethods>(
      `${API_BASE_URL}/api/oauth/auth-methods`
    )
    return providers || rest
  },
}
