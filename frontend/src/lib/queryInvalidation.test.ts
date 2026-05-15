import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateConfigCaches } from './queryInvalidation'

vi.mock('./queryInvalidation', async () => {
  const actual = await vi.importActual('./queryInvalidation')
  return {
    ...actual,
  }
})

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

describe('invalidateConfigCaches', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = createTestQueryClient()
  })

  it('removes stale provider/model/config data when clearModelData is true', async () => {
    queryClient.setQueryData(['providers-with-models', 'http://localhost:5551', '/test'], [{ id: 'old-provider' }])
    queryClient.setQueryData(['opencode', 'providers', 'http://localhost:5551', '/test'], { providers: [{ id: 'old-provider' }] })
    queryClient.setQueryData(['opencode', 'config', 'http://localhost:5551', '/test'], { model: 'old/model' })

    await invalidateConfigCaches(queryClient, { clearModelData: true })

    expect(queryClient.getQueryData(['providers-with-models', 'http://localhost:5551', '/test'])).toBeUndefined()
    expect(queryClient.getQueryData(['opencode', 'providers', 'http://localhost:5551', '/test'])).toBeUndefined()
    expect(queryClient.getQueryData(['opencode', 'config', 'http://localhost:5551', '/test'])).toBeUndefined()
  })

  it('does not remove cached query data by default when clearModelData is not set', async () => {
    queryClient.setQueryData(['providers-with-models', 'http://localhost:5551', '/test'], [{ id: 'old-provider' }])
    queryClient.setQueryData(['opencode', 'providers', 'http://localhost:5551', '/test'], { providers: [{ id: 'old-provider' }] })
    queryClient.setQueryData(['opencode', 'config', 'http://localhost:5551', '/test'], { model: 'old/model' })

    await invalidateConfigCaches(queryClient)

    expect(queryClient.getQueryData(['providers-with-models', 'http://localhost:5551', '/test'])).toEqual([{ id: 'old-provider' }])
    expect(queryClient.getQueryData(['opencode', 'providers', 'http://localhost:5551', '/test'])).toEqual({ providers: [{ id: 'old-provider' }] })
    expect(queryClient.getQueryData(['opencode', 'config', 'http://localhost:5551', '/test'])).toEqual({ model: 'old/model' })
  })
})
