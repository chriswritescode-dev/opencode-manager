import { describe, it, expect } from 'vitest'
import {
  REMOTE_MANAGER_URL_ENV,
  REMOTE_REPO_ID_ENV,
  buildRemoteAttachEnv,
  readRemoteContext,
} from '../src/remote-context.js'

describe('buildRemoteAttachEnv', () => {
  it('round-trips through readRemoteContext', () => {
    const env = buildRemoteAttachEnv('https://mgr.example.com', 'oc-manager', 7)
    const result = readRemoteContext(env)

    expect(result).toEqual({
      managerUrl: 'https://mgr.example.com',
      managerHost: 'mgr.example.com',
      repoName: 'oc-manager',
      repoId: 7,
    })
  })
})

describe('readRemoteContext', () => {
  it('returns undefined when env has no remote vars', () => {
    expect(readRemoteContext({})).toBeUndefined()
  })

  it('returns undefined when URL is empty string', () => {
    expect(readRemoteContext({ [REMOTE_MANAGER_URL_ENV]: '' })).toBeUndefined()
  })

  it('preserves port in managerHost', () => {
    const env = { [REMOTE_MANAGER_URL_ENV]: 'https://mgr.example.com:8443/base' }
    const result = readRemoteContext(env)

    expect(result?.managerHost).toBe('mgr.example.com:8443')
  })

  it('falls back to raw trimmed value for invalid URLs', () => {
    const env = { [REMOTE_MANAGER_URL_ENV]: 'not a url' }
    const result = readRemoteContext(env)

    expect(result?.managerHost).toBe('not a url')
  })

  it('returns undefined repoName when only URL var is set', () => {
    const env = { [REMOTE_MANAGER_URL_ENV]: 'https://mgr.example.com' }
    const result = readRemoteContext(env)

    expect(result?.repoName).toBeUndefined()
  })

  it('returns the trimmed raw manager URL', () => {
    const env = { [REMOTE_MANAGER_URL_ENV]: '  https://mgr.example.com  ' }
    const result = readRemoteContext(env)

    expect(result?.managerUrl).toBe('https://mgr.example.com')
  })

  it('returns undefined repoId when the repo id var is missing', () => {
    const env = { [REMOTE_MANAGER_URL_ENV]: 'https://mgr.example.com' }
    const result = readRemoteContext(env)

    expect(result?.repoId).toBeUndefined()
  })

  it.each(['', 'abc', '0', '-1', '3.5'])('returns undefined repoId for %j', (value) => {
    const env = { [REMOTE_MANAGER_URL_ENV]: 'https://mgr.example.com', [REMOTE_REPO_ID_ENV]: value }
    const result = readRemoteContext(env)

    expect(result?.repoId).toBeUndefined()
  })

  it('returns the numeric repoId when the repo id var is a positive integer', () => {
    const env = { [REMOTE_MANAGER_URL_ENV]: 'https://mgr.example.com', [REMOTE_REPO_ID_ENV]: '42' }
    const result = readRemoteContext(env)

    expect(result?.repoId).toBe(42)
  })
})