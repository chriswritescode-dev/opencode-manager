import { describe, it, expect, beforeEach } from 'vitest'
import { resolveConfig } from '../src/config'

describe('resolveConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OPENCODE_MANAGER_URL
    delete process.env.OPENCODE_MANAGER_INTERNAL_TOKEN
  })

  it('throws when managerUrl is missing', () => {
    expect(() => resolveConfig({})).toThrow('managerUrl is required')
  })

  it('throws when managerToken is missing', () => {
    expect(() => resolveConfig({ managerUrl: 'http://localhost:5003' })).toThrow('managerToken is required')
  })

  it('uses options over env vars', () => {
    const config = resolveConfig({
      managerUrl: 'http://localhost:5003',
      managerToken: 'test-token',
      connectionId: 'my-conn',
    })
    expect(config.managerUrl).toBe('http://localhost:5003')
    expect(config.managerToken).toBe('test-token')
    expect(config.connectionId).toBe('my-conn')
  })

  it('falls back to env vars', () => {
    process.env.OPENCODE_MANAGER_URL = 'http://env-host:5003'
    process.env.OPENCODE_MANAGER_INTERNAL_TOKEN = 'env-token'
    const config = resolveConfig({})
    expect(config.managerUrl).toBe('http://env-host:5003')
    expect(config.managerToken).toBe('env-token')
    expect(config.connectionId).toBe('default')
  })

  it('defaults connectionId to default', () => {
    const config = resolveConfig({
      managerUrl: 'http://localhost:5003',
      managerToken: 'token',
    })
    expect(config.connectionId).toBe('default')
  })
})
