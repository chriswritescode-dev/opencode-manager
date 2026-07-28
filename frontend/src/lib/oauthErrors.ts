import { OAUTH_ERROR_CATEGORIES, type OAuthErrorCategory } from '@opencode-manager/shared/schemas'

const ERROR_MAPPINGS: Record<OAuthErrorCategory, string> = {
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

  const lower = err.message.toLowerCase()
  for (const category of OAUTH_ERROR_CATEGORIES) {
    if (lower.includes(category)) {
      return ERROR_MAPPINGS[category]
    }
  }

  return err.message || defaultMessage
}
