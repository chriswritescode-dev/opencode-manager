import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpOAuthFlow } from '../../src/services/mcp-oauth-state'

function createFlow(overrides: Partial<Omit<McpOAuthFlow, 'timestamp'>> = {}): Omit<McpOAuthFlow, 'timestamp'> {
  return {
    state: 'state-1',
    serverName: 'test-server',
    integrationID: 'int-1',
    attemptID: 'att-1',
    callbackPort: 5104,
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

  it('stores a flow with a timestamp and looks it up by state and attempt', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    const before = Date.now()

    state.storeMcpOAuthFlow(createFlow())

    const flow = state.consumeMcpOAuthFlow('state-1')
    expect(flow).toMatchObject({
      state: 'state-1',
      serverName: 'test-server',
      integrationID: 'int-1',
      attemptID: 'att-1',
      callbackPort: 5104,
      directory: '/tmp/project',
    })
    expect(flow?.timestamp).toBeGreaterThanOrEqual(before)
    expect(flow?.timestamp).toBeLessThanOrEqual(Date.now())
    expect(state.getMcpOAuthFlowByAttempt('att-1')).toMatchObject({ state: 'state-1' })
  })

  it('consumes a flow only once while keeping the attempt lookup', async () => {
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow(createFlow())

    expect(state.consumeMcpOAuthFlow('state-1')).toBeDefined()
    expect(state.consumeMcpOAuthFlow('state-1')).toBeUndefined()
    expect(state.getMcpOAuthFlowByAttempt('att-1')).toBeDefined()
  })

  it('returns undefined for unknown states and attempts', async () => {
    const state = await import('../../src/services/mcp-oauth-state')

    expect(state.consumeMcpOAuthFlow('missing')).toBeUndefined()
    expect(state.getMcpOAuthFlowByAttempt('missing')).toBeUndefined()
  })

  it('expires stored flows after the TTL', async () => {
    vi.useFakeTimers()
    const state = await import('../../src/services/mcp-oauth-state')
    state.storeMcpOAuthFlow(createFlow())

    vi.advanceTimersByTime(11 * 60 * 1000)

    expect(state.consumeMcpOAuthFlow('state-1')).toBeUndefined()
    expect(state.getMcpOAuthFlowByAttempt('att-1')).toBeUndefined()
  })
})
