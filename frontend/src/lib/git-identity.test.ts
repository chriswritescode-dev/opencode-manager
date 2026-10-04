import { describe, it, expect } from 'vitest'
import { formatGitIdentity } from './git-identity'

describe('formatGitIdentity', () => {
  it('formats a complete identity as Name <email>', () => {
    expect(formatGitIdentity({ name: 'Ada Lovelace', email: 'ada@example.com' }))
      .toBe('Ada Lovelace <ada@example.com>')
  })

  it('falls back to No name when the name is missing', () => {
    expect(formatGitIdentity({ name: null, email: 'ada@example.com' }))
      .toBe('No name <ada@example.com>')
  })

  it('falls back to No email when the email is missing', () => {
    expect(formatGitIdentity({ name: 'Ada Lovelace', email: null }))
      .toBe('Ada Lovelace <No email>')
  })

  it('reports Not configured when nothing is set', () => {
    expect(formatGitIdentity({ name: null, email: null })).toBe('Not configured')
    expect(formatGitIdentity({})).toBe('Not configured')
  })
})
