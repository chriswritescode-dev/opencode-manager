import { FetchError } from '@opencode-manager/shared'
import { isOAuthErrorCode, type OAuthErrorCode } from '@opencode-manager/shared/schemas'

const ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  IntegrationNotFoundError: 'This provider is no longer available. Please reopen settings and try again.',
  IntegrationAttemptNotFoundError: 'This authorization attempt expired. Please start the OAuth flow again.',
  IntegrationMethodNotFoundError: 'The selected authentication method is no longer available. Please choose another one.',
  InvalidRequestError: 'The provider rejected the authentication details. Please check them and try again.',
  ClientError: 'Could not reach the OpenCode server. Please try again.',
}

export function mapOAuthError(err: unknown, context: 'authorize' | 'callback' | 'credential'): string {
  const defaultMessage = context === 'authorize'
    ? 'Failed to initiate OAuth authorization'
    : context === 'callback'
      ? 'Failed to complete OAuth callback'
      : 'Failed to save API key. Please try again.'

  if (!(err instanceof Error)) return defaultMessage

  if (err instanceof FetchError && err.code && isOAuthErrorCode(err.code)) {
    return ERROR_MESSAGES[err.code]
  }

  return err.message || defaultMessage
}
