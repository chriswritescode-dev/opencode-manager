import { z } from "zod";
import type {
  ProviderOauthAuthorizeErrors,
  ProviderOauthCallbackErrors,
} from "@opencode-ai/sdk/v2/types";

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

export const PROVIDER_AUTH_ERROR_NAMES = [
  "BadRequest",
  "ProviderAuthOauthMissing",
  "ProviderAuthOauthCodeMissing",
  "ProviderAuthOauthCallbackFailed",
  "ProviderAuthValidationFailed",
] as const;

export type ProviderAuthErrorName = (typeof PROVIDER_AUTH_ERROR_NAMES)[number];

export const ProviderAuthErrorSchema = z.object({
  name: z.enum(PROVIDER_AUTH_ERROR_NAMES),
  data: z.object({
    providerID: z.string().optional(),
    field: z.string().optional(),
    message: z.string().optional(),
    kind: z.string().optional(),
  }),
});

export const InvalidRequestErrorSchema = z.object({
  _tag: z.literal("InvalidRequestError"),
  message: z.string(),
  kind: z.string().optional(),
  field: z.string().optional(),
});

export const OpenCodeOAuthErrorSchema = z.union([
  ProviderAuthErrorSchema,
  InvalidRequestErrorSchema,
]);

export type OpenCodeOAuthError = z.infer<typeof OpenCodeOAuthErrorSchema>;

export const OAUTH_ERROR_CODES = [
  ...PROVIDER_AUTH_ERROR_NAMES,
  "InvalidRequestError",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function oauthErrorCode(error: OpenCodeOAuthError): OAuthErrorCode {
  return "_tag" in error ? error._tag : error.name;
}

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type OpenCodeOAuthErrorMatchesAuthorize = Assert<
  MutuallyAssignable<OpenCodeOAuthError, ProviderOauthAuthorizeErrors[400]>
>;

export type OpenCodeOAuthErrorMatchesCallback = Assert<
  MutuallyAssignable<OpenCodeOAuthError, ProviderOauthCallbackErrors[400]>
>;
