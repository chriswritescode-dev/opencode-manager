import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpOAuthFlowState } from '../../src/services/mcp-oauth-state'

function createFlow(overrides: Partial<Omit<McpOAuthFlowState, 'timestamp'>> = {}): Omit<McpOAuthFlowState, 'timestamp'> {
  return {
    serverName: 'test-server',
    serverUrl: 'https://mcp.example.com',
    codeVerifier: 'verifier-1',
    clientId: 'client-1',
    callbackUrl: 'http://localhost:5003/api/mcp-oauth-proxy/callback',
    tokenEndpoint: 'https://mcp.example.com/token',
    directory: '/tmp/project',
    ...overrides,
  }
}

describe('mcp-oauth-state', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores a flow with a timestamp and reports it as pending', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    const before = Date.now()

    state.storeMcpOAuthFlow('state-1', createFlow())

    const result = state.getMcpOAuthFlowResult('state-1')
    expect(result).toEqual({ status: 'pending' })

    const flow = state.consumeMcpOAuthFlow('state-1')
    expect(flow).toMatchObject({ serverName: 'test-server', clientId: 'client-1'.replace('client-1', 'client-1') })
    expect(flow?.timestamp).toBeGreaterThanOrEqual(before)
    expect(flow?.timestamp).toBeLessThanOrEqual(Date.now())
  })

  it('consumes a flow only once', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow('state-2', createFlow())

    expect(state.consumeMcpOAuthFlow('state-2')).toBeDefined()
    expect(state.consumeMcpOAuthFlow('state-2')).toBeUndefined()
  })

  it('returns undefined for unknown flows and results', async () => {
    const state = await import('../../src/services/mcp-oauth-state')

    expect(state.consumeMcpOAuthFlow('missing')).toBeUndefined()
    expect(state.getMcpOAuthFlowResult('missing')).toBeUndefined()
  })

  it('marks a flow completed and returns the server name', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow('state-3', createFlow({ serverName: 'server-three' }))

    state.markMcpOAuthFlowCompleted('state-3', 'server-three')

    expect(state.getMcpOAuthFlowResult('state-3')).toEqual({ status: 'completed', serverName: 'server-three' })
    expect(state.consumeMcpOAuthFlow('state-3')).toBeDefined()
  })

  it('marks a flow failed and returns the error', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow('state-4', createFlow())

    state.markMcpOAuthFlowFailed('state-4', 'token exchange failed')

    expect(state.getMcpOAuthFlowResult('state-4')).toEqual({ status: 'failed', error: 'token exchange failed' })
  })

  it('deletes a stored flow without touching its result', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow('state-5', createFlow())

    state.deleteMcpOAuthFlow('state-5')

    expect(state.consumeMcpOAuthFlow('state-5')).toBeUndefined()
    expect(state.getMcpOAuthFlowResult('state-5')).toEqual({ status: 'pending' })
  })

  it('expires stored flows after the state TTL', async () => {
    vi.useFakeTimers()
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow('state-6', createFlow())

    vi.advanceTimersByTime(11 * 60 * 1000)

    expect(state.consumeMcpOAuthFlow('state-6')).toBeUndefined()
    expect(state.getMcpOAuthFlowResult('state-6')).toBeUndefined()
  })

  it('expires flow results after the result TTL', async () => {
    vi.useFakeTimers()
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow('state-7', createFlow())
    state.markMcpOAuthFlowCompleted('state-7', 'server-seven')

    vi.advanceTimersByTime(6 * 60 * 1000)

    expect(state.getMcpOAuthFlowResult('state-7')).toBeUndefined()
  })
})
