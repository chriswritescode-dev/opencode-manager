export const OAuthMethod = {
  AUTO: 0,
  CODE: 1,
} as const

export type OAuthMethodType = (typeof OAuthMethod)[keyof typeof OAuthMethod]

const ERROR_MAPPINGS: Record<string, string> = {
  'invalid code': 'Invalid authorization code. Please try the OAuth flow again.',
  'expired': 'Authorization code has expired. Please try the OAuth flow again.',
  'access denied': 'Access was denied. Please check the permissions and try again.',
  'server error': 'Server error occurred. Please try again later.',
  'provider not found': 'Provider is not available or does not support OAuth.',
  'invalid method': 'Invalid authentication method selected.',
}

export function mapOAuthError(err: unknown, context: 'authorize' | 'callback'): string {
  const defaultMessage = context === 'authorize'
    ? 'Failed to initiate OAuth authorization'
    : 'Failed to complete OAuth callback'

  if (!(err instanceof Error)) return defaultMessage

  for (const [key, message] of Object.entries(ERROR_MAPPINGS)) {
    if (err.message.toLowerCase().includes(key)) {
      return message
    }
  }

  return err.message || defaultMessage
}
