import { z } from "zod";

export const PromptAnswerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const PromptAnswerSchema = z.record(z.string(), PromptAnswerValueSchema);

export type PromptAnswerValue = z.infer<typeof PromptAnswerValueSchema>;

export type PromptAnswer = z.infer<typeof PromptAnswerSchema>;

export const SetCredentialRequestSchema = z.object({
  apiKey: z.string().min(1),
  answer: PromptAnswerSchema.optional(),
});

export type SetCredentialRequest = z.infer<typeof SetCredentialRequestSchema>;

export const CredentialStatusResponseSchema = z.object({
  hasCredentials: z.boolean(),
});

export type CredentialStatusResponse = z.infer<typeof CredentialStatusResponseSchema>;

export const CredentialListResponseSchema = z.object({
  providers: z.array(z.string()),
});

export type CredentialListResponse = z.infer<typeof CredentialListResponseSchema>;

export const PromptConditionSchema = z.object({
  key: z.string(),
  op: z.enum(["eq", "neq"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export type PromptCondition = z.infer<typeof PromptConditionSchema>;

export const PromptFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    key: z.string(),
    message: z.string(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    default: z.string().optional(),
    when: z.array(PromptConditionSchema).optional(),
  }),
  z.object({
    type: z.literal("select"),
    key: z.string(),
    message: z.string(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
    })),
    required: z.boolean().optional(),
    default: z.string().optional(),
    when: z.array(PromptConditionSchema).optional(),
  }),
  z.object({
    type: z.literal("boolean"),
    key: z.string(),
    message: z.string(),
    required: z.boolean().optional(),
    default: z.boolean().optional(),
    when: z.array(PromptConditionSchema).optional(),
  }),
  z.object({
    type: z.literal("multiselect"),
    key: z.string(),
    message: z.string(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
    })),
    required: z.boolean().optional(),
    default: z.array(z.string()).optional(),
    when: z.array(PromptConditionSchema).optional(),
  }),
  z.object({
    type: z.literal("number"),
    key: z.string(),
    message: z.string(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    required: z.boolean().optional(),
    default: z.number().optional(),
    when: z.array(PromptConditionSchema).optional(),
  }),
  z.object({
    type: z.literal("external"),
    key: z.string(),
    message: z.string(),
    url: z.string(),
  }),
]);

export type PromptField = z.infer<typeof PromptFieldSchema>;

export const ProviderAuthMethodSchema = z.object({
  id: z.string(),
  type: z.enum(["oauth", "key", "command", "env"]),
  label: z.string(),
  fields: z.array(PromptFieldSchema).optional(),
});

export type ProviderAuthMethod = z.infer<typeof ProviderAuthMethodSchema>;

export const ProviderAuthMethodsSchema = z.record(z.string(), z.array(ProviderAuthMethodSchema));

export type ProviderAuthMethods = z.infer<typeof ProviderAuthMethodsSchema>;

export const ProviderAuthMethodsResponseSchema = z.object({
  providers: ProviderAuthMethodsSchema,
});

export type ProviderAuthMethodsResponse = z.infer<typeof ProviderAuthMethodsResponseSchema>;

export const OAuthAuthorizeRequestSchema = z.object({
  methodID: z.string().min(1),
  answer: PromptAnswerSchema.optional(),
});

export type OAuthAuthorizeRequest = z.infer<typeof OAuthAuthorizeRequestSchema>;

export const OAuthAuthorizeResponseSchema = z.object({
  attemptID: z.string(),
  url: z.string(),
  instructions: z.string(),
  mode: z.enum(["auto", "code"]),
});

export type OAuthAuthorizeResponse = z.infer<typeof OAuthAuthorizeResponseSchema>;

export const OAuthAttemptStatusSchema = z.object({
  status: z.enum(["pending", "complete", "failed", "expired"]),
  message: z.string().optional(),
});

export type OAuthAttemptStatus = z.infer<typeof OAuthAttemptStatusSchema>;

export const OAuthCallbackRequestSchema = z.object({
  attemptID: z.string().min(1),
  code: z.string().optional(),
});

export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;

export const OAUTH_ERROR_CODES = [
  "IntegrationNotFoundError",
  "IntegrationAttemptNotFoundError",
  "IntegrationMethodNotFoundError",
  "InvalidRequestError",
  "ClientError",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function isOAuthErrorCode(code: string): code is OAuthErrorCode {
  return (OAUTH_ERROR_CODES as readonly string[]).includes(code);
}
