import { FetchError } from '@opencode-manager/shared'
import { OAUTH_ERROR_CODES, type OAuthErrorCode } from '@opencode-manager/shared/schemas'

const ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  BadRequest: 'The provider rejected the request. Please try the OAuth flow again.',
  ProviderAuthOauthMissing: 'No authorization is in progress for this provider. Please start the OAuth flow again.',
  ProviderAuthOauthCodeMissing: 'An authorization code is required. Please paste the code from the provider.',
  ProviderAuthOauthCallbackFailed: 'The provider rejected the authorization. It may have expired — please try again.',
  ProviderAuthValidationFailed: 'Some authentication details were invalid. Please check them and try again.',
  InvalidRequestError: 'The request was invalid. Please check your details and try again.',
}

function isOAuthErrorCode(code: string): code is OAuthErrorCode {
  return (OAUTH_ERROR_CODES as readonly string[]).includes(code)
}

export function mapOAuthError(err: unknown, context: 'authorize' | 'callback'): string {
  const defaultMessage = context === 'authorize'
    ? 'Failed to initiate OAuth authorization'
    : 'Failed to complete OAuth callback'

  if (!(err instanceof Error)) return defaultMessage

  if (err instanceof FetchError && err.code && isOAuthErrorCode(err.code)) {
    return err.detail
      ? `${ERROR_MESSAGES[err.code]} (${err.detail})`
      : ERROR_MESSAGES[err.code]
  }

  return err.message || defaultMessage
}
