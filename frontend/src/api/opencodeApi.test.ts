import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOpenCodeApi, openCodeApiBaseUrl } from './opencodeApi'
import { API_BASE_URL, OPENCODE_API_ENDPOINT } from '@/config'

describe('openCodeApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the local server on the direct OpenCode endpoint', () => {
    expect(openCodeApiBaseUrl()).toBe(OPENCODE_API_ENDPOINT)
    expect(openCodeApiBaseUrl('local')).toBe(OPENCODE_API_ENDPOINT)
  })

  it('routes remote servers through the backend proxy', () => {
    expect(openCodeApiBaseUrl('srv_abc')).toBe(`${API_BASE_URL}/api/opencode/servers/srv_abc`)
  })

  it('memoizes one client per server', () => {
    const local = getOpenCodeApi()
    const remote = getOpenCodeApi('srv_abc')

    expect(getOpenCodeApi()).toBe(local)
    expect(getOpenCodeApi('local')).toBe(local)
    expect(getOpenCodeApi('srv_abc')).toBe(remote)
    expect(getOpenCodeApi('srv_other')).not.toBe(remote)
  })
})
