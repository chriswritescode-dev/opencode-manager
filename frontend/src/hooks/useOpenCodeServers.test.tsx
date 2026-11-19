import { act, waitFor } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { useOpenCodeServers } from './useOpenCodeServers'
import { renderHookWithProviders } from '@/test/render'
import { makeOpenCodeServer } from '@/test/fixtures/api'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })

const serversRoute = (respond: () => { json: object } | Promise<{ json: object }>) => ({
  method: 'GET' as const,
  path: '/api/opencode-servers',
  respond,
})

describe('useOpenCodeServers', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('reports an in-flight first load as initial loading', () => {
    const { result } = renderHookWithProviders(() => useOpenCodeServers(), {
      ...hookProviders,
      fetchRoutes: [serversRoute(() => new Promise(() => {}))],
    })

    expect(result.current.isPaused).toBe(false)
    expect(result.current.showsInitialLoading).toBe(true)
  })

  it('reports a paused offline fetch as paused instead of initial loading', () => {
    onlineManager.setOnline(false)

    const { result, fetchFake } = renderHookWithProviders(() => useOpenCodeServers(), {
      ...hookProviders,
      fetchRoutes: [serversRoute(() => new Promise(() => {}))],
    })

    expect(result.current.isPaused).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.servers).toEqual([])
    expect(result.current.showsInitialLoading).toBe(false)
    expect(fetchFake.findRequests('GET', '/api/opencode-servers')).toHaveLength(0)
  })

  it('keeps the cached server list and leaves it unloaded while a refetch is paused', async () => {
    let requests = 0
    const { result } = renderHookWithProviders(() => useOpenCodeServers(), {
      ...hookProviders,
      fetchRoutes: [
        serversRoute(() => {
          requests += 1
          if (requests === 1) return { json: { servers: [kitchen] } }
          return new Promise(() => {})
        }),
      ],
    })

    await waitFor(() => expect(result.current.servers).toEqual([kitchen]))

    onlineManager.setOnline(false)
    act(() => {
      void result.current.refetch()
    })

    await waitFor(() => expect(result.current.isPaused).toBe(true))
    expect(result.current.servers).toEqual([kitchen])
    expect(result.current.showsInitialLoading).toBe(false)
  })
})
