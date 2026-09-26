import { API_BASE_URL } from "@/config"
import type { FormAnswer, IntegrationMethod } from "@opencode-manager/shared/opencode"
import type { OAuthAttemptStatus, OAuthAuthorizeResponse } from "@opencode-manager/shared/schemas"
import { fetchWrapper, fetchWrapperVoid } from "./fetchWrapper"

export type {
  FormAnswer,
  FormField,
  FormValue,
  IntegrationKeyMethod,
  IntegrationMethod,
  IntegrationOAuthMethod,
} from "@opencode-manager/shared/opencode"

export type { OAuthAuthorizeResponse } from "@opencode-manager/shared/schemas"

type ProviderAuthMethods = Record<string, IntegrationMethod[]>

export const oauthApi = {
  authorize: async (providerId: string, methodID: string, answer?: FormAnswer): Promise<OAuthAuthorizeResponse> =>
    fetchWrapper<OAuthAuthorizeResponse>(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ methodID, answer }),
    }),

  getStatus: async (providerId: string, attemptID: string): Promise<OAuthAttemptStatus> =>
    fetchWrapper<OAuthAttemptStatus>(`${API_BASE_URL}/api/oauth/${providerId}/oauth/${attemptID}`),

  callback: async (providerId: string, attemptID: string, code?: string): Promise<void> =>
    fetchWrapperVoid(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptID, code }),
    }),

  cancel: async (providerId: string, attemptID: string): Promise<void> =>
    fetchWrapperVoid(`${API_BASE_URL}/api/oauth/${providerId}/oauth/${attemptID}`, {
      method: 'DELETE',
    }),

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    const { providers } = await fetchWrapper<{ providers: ProviderAuthMethods }>(
      `${API_BASE_URL}/api/oauth/auth-methods`
    )
    return providers
  },
}
