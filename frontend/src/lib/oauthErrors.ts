import { FetchError } from '@opencode-manager/shared'
import { isOAuthErrorCode } from '@opencode-manager/shared/schemas'

const ERROR_MESSAGES = {
  IntegrationNotFoundError: 'This provider is no longer available. Please reopen settings and try again.',
  IntegrationAttemptNotFoundError: 'This authorization attempt expired. Please start the OAuth flow again.',
  IntegrationMethodNotFoundError: 'The selected authentication method is no longer available. Please choose another one.',
  InvalidRequestError: 'The provider rejected the authentication details. Please check them and try again.',
  ClientError: 'Could not reach the OpenCode server. Please try again.',
}

export function mapOAuthError(cause: unknown, context: 'authorize' | 'callback' | 'credential'): string {
  const defaultMessage = context === 'authorize'
    ? 'Failed to initiate OAuth authorization'
    : context === 'callback'
      ? 'Failed to complete OAuth callback'
      : 'Failed to save API key. Please try again.'

  if (!(cause instanceof Error)) return defaultMessage

  if (cause instanceof FetchError && cause.code && isOAuthErrorCode(cause.code)) {
    return ERROR_MESSAGES[cause.code]
  }

  return cause.message || defaultMessage
}
