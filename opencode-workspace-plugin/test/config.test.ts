import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveConfig } from '../src/config'
import * as keychain from '../src/keychain'

describe('resolveConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OPENCODE_MANAGER_URL
    delete process.env.OPENCODE_MANAGER_INTERNAL_TOKEN
    vi.spyOn(keychain, 'getToken').mockReturnValue(null)
  })

  it('throws when managerUrl is missing', () => {
    expect(() => resolveConfig({})).toThrow('managerUrl is required')
  })

  it('throws when managerToken is missing from all sources', () => {
    expect(() => resolveConfig({ managerUrl: 'http://localhost:5003' })).toThrow('managerToken not found')
  })

  it('uses options over env vars and Keychain', () => {
    process.env.OPENCODE_MANAGER_INTERNAL_TOKEN = 'env-token'
    vi.spyOn(keychain, 'getToken').mockReturnValue('keychain-token')
    const config = resolveConfig({
      managerUrl: 'http://localhost:5003',
      managerToken: 'option-token',
      connectionId: 'my-conn',
    })
    expect(config.managerUrl).toBe('http://localhost:5003')
    expect(config.managerToken).toBe('option-token')
    expect(config.tokenSource).toBe('option')
    expect(config.connectionId).toBe('my-conn')
  })

  it('falls back to env vars', () => {
    process.env.OPENCODE_MANAGER_URL = 'http://env-host:5003'
    process.env.OPENCODE_MANAGER_INTERNAL_TOKEN = 'env-token'
    const config = resolveConfig({})
    expect(config.managerUrl).toBe('http://env-host:5003')
    expect(config.managerToken).toBe('env-token')
    expect(config.tokenSource).toBe('env')
    expect(config.connectionId).toBe('default')
  })

  it('falls back to Keychain when option and env missing', () => {
    vi.spyOn(keychain, 'getToken').mockReturnValue('keychain-token')
    const config = resolveConfig({ managerUrl: 'http://localhost:5003' })
    expect(config.managerToken).toBe('keychain-token')
    expect(config.tokenSource).toBe('keychain')
  })

  it('defaults connectionId to default', () => {
    const config = resolveConfig({
      managerUrl: 'http://localhost:5003',
      managerToken: 'token',
    })
    expect(config.connectionId).toBe('default')
  })

  it('strips trailing slashes from managerUrl', () => {
    const config = resolveConfig({
      managerUrl: 'http://localhost:5003///',
      managerToken: 'token',
    })
    expect(config.managerUrl).toBe('http://localhost:5003')
  })
})
