import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMcpServers } from './useMcpServers'
import { renderHookWithProviders } from '@/test/render'

const connectRoute = '/api/opencode/api/experimental/mcp/:server/connect'

describe('useMcpServers', () => {
  it('invalidates session transcript caches through the shared predicate after connecting', async () => {
    const { result, queryClient, fetchFake } = renderHookWithProviders(() => useMcpServers(), {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: [
        {
          method: 'GET',
          path: '/api/opencode/api/mcp',
          respond: () => ({ json: { location: { directory: '/workspace/demo' }, data: [] } }),
        },
        { method: 'POST', path: connectRoute, respond: () => ({ status: 204 }) },
      ],
    })

    queryClient.setQueryData(['opencode', 'transcript', 'session-1'], { transcript: { messages: [] } })
    queryClient.setQueryData(['opencode', 'session', 'session-1'], { id: 'session-1' })
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })
    queryClient.setQueryData(['opencode', 'messages', 'session-1'], [])

    await act(async () => {
      await result.current.connectAsync('server')
    })

    expect(fetchFake.lastRequest('POST', connectRoute)?.path).toBe(
      '/api/opencode/api/experimental/mcp/server/connect',
    )
    expect(queryClient.getQueryState(['opencode', 'transcript', 'session-1'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['opencode', 'session', 'session-1'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['opencode', 'messages', 'session-1'])?.isInvalidated).toBe(false)
    expect(await screen.findByText('MCP server connected')).toBeInTheDocument()
  })

  it('reports a failed connection', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useMcpServers(), {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: [
        {
          method: 'GET',
          path: '/api/opencode/api/mcp',
          respond: () => ({ json: { location: { directory: '/workspace/demo' }, data: [] } }),
        },
        { method: 'POST', path: connectRoute, respond: () => ({ status: 500, json: { error: 'boom' } }) },
      ],
    })

    await act(async () => {
      await expect(result.current.connectAsync('server')).rejects.toThrow('UnexpectedStatus: 500')
    })

    await waitFor(() => expect(fetchFake.findRequests('POST', connectRoute)).toHaveLength(1))
    expect(await screen.findByText('Failed to connect MCP server: UnexpectedStatus: 500')).toBeInTheDocument()
  })
})
