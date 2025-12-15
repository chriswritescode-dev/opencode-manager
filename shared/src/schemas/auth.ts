import { z } from "zod";

export const AuthEntrySchema = z.object({
  type: z.enum(["apiKey", "oauth"]),
  apiKey: z.string().optional(),
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

export const ProviderAuthMethodSchema = z.object({
  type: z.enum(["oauth", "api"]),
  label: z.string(),
});

export const ProviderAuthMethodsSchema = z.record(z.string(), z.array(ProviderAuthMethodSchema));

export const OAuthAuthorizeRequestSchema = z.object({
  method: z.number(),
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
});
