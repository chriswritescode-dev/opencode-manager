import { describe, it, expect } from 'vitest'
import {
  REMOTE_MANAGER_URL_ENV,
  buildRemoteAttachEnv,
  readRemoteContext,
} from '../src/remote-context.js'

describe('buildRemoteAttachEnv', () => {
  it('round-trips through readRemoteContext', () => {
    const env = buildRemoteAttachEnv('https://mgr.example.com', 'oc-manager')
    const result = readRemoteContext(env)

    expect(result).toEqual({ managerHost: 'mgr.example.com', repoName: 'oc-manager' })
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
})