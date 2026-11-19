import { API_BASE_URL } from "@/config"
import { z } from "zod"
import type { FormAnswer, IntegrationInfo, IntegrationMethod } from "@opencode-manager/shared/opencode"
import { OAuthAttemptStatusSchema, OAuthAuthorizeResponseSchema } from "@opencode-manager/shared/schemas"
import type { OAuthAttemptStatus, OAuthAuthorizeResponse } from "@opencode-manager/shared/schemas"
import { fetchWrapper, fetchWrapperVoid } from "./fetchWrapper"
import { callOpenCode } from "./opencodeApi"

export type {
  FormAnswer,
  FormField,
  FormValue,
  IntegrationInfo,
  IntegrationKeyMethod,
  IntegrationMethod,
  IntegrationOAuthMethod,
} from "@opencode-manager/shared/opencode"

export type { OAuthAuthorizeResponse } from "@opencode-manager/shared/schemas"

type ProviderAuthMethods = Record<string, IntegrationMethod[]>

const formWhenSchema = z.object({
  key: z.string(),
  op: z.enum(['eq', 'neq']),
  value: z.union([z.string(), z.number(), z.boolean()]),
})

const formOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const formFieldBase = {
  key: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  when: z.array(formWhenSchema).optional(),
}

const formStringFieldSchema = z.object({
  ...formFieldBase,
  type: z.literal('string'),
  format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  options: z.array(formOptionSchema).optional(),
  custom: z.boolean().optional(),
})

const formNumberFieldSchema = z.object({
  ...formFieldBase,
  type: z.literal('number'),
  minimum: z.union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')]).optional(),
  maximum: z.union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')]).optional(),
  default: z.union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')]).optional(),
})

const formIntegerFieldSchema = z.object({
  ...formFieldBase,
  type: z.literal('integer'),
  minimum: z.union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')]).optional(),
  maximum: z.union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')]).optional(),
  default: z.union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')]).optional(),
})

const formBooleanFieldSchema = z.object({
  ...formFieldBase,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
})

const formMultiselectFieldSchema = z.object({
  ...formFieldBase,
  type: z.literal('multiselect'),
  options: z.array(formOptionSchema),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
  custom: z.boolean().optional(),
  default: z.array(z.string()).optional(),
})

const formExternalFieldSchema = z.object({
  key: z.string(),
  type: z.literal('external'),
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
})

const formFieldSchema = z.discriminatedUnion('type', [
  formStringFieldSchema,
  formNumberFieldSchema,
  formIntegerFieldSchema,
  formBooleanFieldSchema,
  formMultiselectFieldSchema,
  formExternalFieldSchema,
])

const formFieldsSchema = z.tuple([formFieldSchema]).rest(formFieldSchema)

const integrationMethodSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('oauth'), label: z.string(), form: formFieldsSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('command'), label: z.string(), command: z.array(z.string()) }),
  z.object({ type: z.literal('key'), label: z.string().optional(), form: formFieldsSchema.optional() }),
  z.object({ id: z.string(), type: z.literal('external'), label: z.string(), form: formFieldsSchema.optional() }),
  z.object({ type: z.literal('env'), names: z.array(z.string()) }),
])

const providerAuthMethodsSchema = z.record(z.string(), z.array(integrationMethodSchema))

export const oauthApi = {
  authorize: async (providerId: string, methodID: string, answer?: FormAnswer): Promise<OAuthAuthorizeResponse> =>
    fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, OAuthAuthorizeResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ methodID, answer }),
    }),

  getStatus: async (providerId: string, attemptID: string): Promise<OAuthAttemptStatus> =>
    fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/${attemptID}`, OAuthAttemptStatusSchema),

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
    const { providers } = await fetchWrapper(
      `${API_BASE_URL}/api/oauth/auth-methods`,
      z.object({ providers: providerAuthMethodsSchema }),
    )
    return providers
  },

  getIntegrations: async (): Promise<IntegrationInfo[]> => {
    const { data } = await callOpenCode((api) => api.integration.list())
    return data
  },
}
