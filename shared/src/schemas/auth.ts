import { z } from "zod";

export const AuthEntrySchema = z.object({
  type: z.enum(["api", "oauth"]),
  key: z.string().optional(),
  refresh: z.string().optional(),
  access: z.string().optional(),
  expires: z.number().optional(),
});

export const AuthCredentialsSchema = z.record(z.string(), AuthEntrySchema);

export const SetCredentialRequestSchema = z.object({
  apiKey: z.string().min(1),
});

export const CredentialStatusResponseSchema = z.object({
  hasCredentials: z.boolean(),
});

export const CredentialListResponseSchema = z.object({
  providers: z.array(z.string()),
});

export const PromptFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    key: z.string(),
    message: z.string(),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal("select"),
    key: z.string(),
    message: z.string(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
    })),
    when: z.object({
      key: z.string(),
      value: z.string(),
    }).optional(),
  }),
]);

export const ProviderAuthMethodSchema = z.object({
  type: z.enum(["oauth", "api"]),
  label: z.string(),
  prompts: z.array(PromptFieldSchema).optional(),
});

export const ProviderAuthMethodsSchema = z.record(z.string(), z.array(ProviderAuthMethodSchema));

export const OAuthAuthorizeRequestSchema = z.object({
  method: z.number(),
  inputs: z.record(z.string(), z.string()).optional(),
});

export const OAuthAuthorizeResponseSchema = z.object({
  url: z.string(),
  method: z.enum(["auto", "code"]),
  instructions: z.string(),
});

export const OAuthCallbackRequestSchema = z.object({
  method: z.number(),
  code: z.string().optional(),
});

export const ProviderAuthMethodsResponseSchema = z.object({
  providers: z.record(z.string(), z.array(ProviderAuthMethodSchema)),
}).or(ProviderAuthMethodsSchema);

export const OAUTH_ERROR_CATEGORIES = [
  "invalid code",
  "expired",
  "access denied",
  "server error",
  "provider not found",
  "invalid method",
] as const;

export type OAuthErrorCategory = (typeof OAUTH_ERROR_CATEGORIES)[number];
