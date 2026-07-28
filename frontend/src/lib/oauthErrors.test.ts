import { describe, it, expect } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import { OAUTH_ERROR_CODES } from '@opencode-manager/shared/schemas'
import { mapOAuthError } from './oauthErrors'

describe('mapOAuthError', () => {
  it('maps every upstream error code to a distinct specific message', () => {
    const messages = OAUTH_ERROR_CODES.map((code) =>
      mapOAuthError(new FetchError('OAuth authorization failed', 400, code), 'authorize'),
    )
    for (const message of messages) {
      expect(message).not.toBe('OAuth authorization failed')
      expect(message).not.toBe('Failed to initiate OAuth authorization')
    }
    expect(new Set(messages).size).toBe(OAUTH_ERROR_CODES.length)
  })

  it('appends upstream detail when present', () => {
    const err = new FetchError(
      'OAuth callback failed',
      400,
      'ProviderAuthValidationFailed',
      'must start with sk- — field: apiKey',
    )
    expect(mapOAuthError(err, 'callback')).toContain('must start with sk- — field: apiKey')
  })

  it('falls back to the raw message for codes outside the contract', () => {
    const err = new FetchError('Upstream unavailable', 502, 'SOMETHING_ELSE')
    expect(mapOAuthError(err, 'authorize')).toBe('Upstream unavailable')
  })

  it('falls back to the phase default for non-Error values', () => {
    expect(mapOAuthError('nope', 'authorize')).toBe('Failed to initiate OAuth authorization')
    expect(mapOAuthError(undefined, 'callback')).toBe('Failed to complete OAuth callback')
  })
})
