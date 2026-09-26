import { z } from "zod";

export const FormAnswerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const FormAnswerSchema = z.record(z.string(), FormAnswerValueSchema);

export const SetCredentialRequestSchema = z.object({
  apiKey: z.string().min(1),
  answer: FormAnswerSchema.optional(),
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

export const OAuthAuthorizeRequestSchema = z.object({
  methodID: z.string().min(1),
  answer: FormAnswerSchema.optional(),
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
