import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLSPStatus } from './useLSPStatus'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LspStatus } from '@/api/opencode'
import { useOpenCodeClient } from './useOpenCode'

vi.mock('./useOpenCode')

const mockGetLSPStatus = vi.fn()
let mockClient: any

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useLSPStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = {
      getLSPStatus: mockGetLSPStatus
    }
  })

  it('should not fetch when client is not available', async () => {
    vi.mocked(useOpenCodeClient).mockReturnValue(null)

    const { result } = renderHook(() => useLSPStatus(null, '/test'), {
      wrapper: createWrapper()
    })

    expect(result.current.isLoading).toBe(false)
    expect(mockGetLSPStatus).not.toHaveBeenCalled()
  })

  it('should fetch LSP status when client is available', async () => {
    const mockServers: LspStatus[] = [
      { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' }
    ]
    mockGetLSPStatus.mockResolvedValue(mockServers)
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGetLSPStatus).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(mockServers)
  })

  it('should use correct query key', async () => {
    mockGetLSPStatus.mockResolvedValue([])
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const queryState = queryClient.getQueryState(['opencode', 'lsp', 'http://localhost:5551', '/test'])
    expect(queryState).toBeTruthy()
    expect(queryState?.status).toBe('success')
  })

  it('should return empty array when no servers active', async () => {
    mockGetLSPStatus.mockResolvedValue([])
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual([])
  })

  it('should return server list with mixed statuses', async () => {
    const mockServers: LspStatus[] = [
      { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' },
      { id: '2', name: 'python-lsp-server', status: 'error', root: '/project' },
      { id: '3', name: 'rust-analyzer', status: 'connected', root: '/project/src' }
    ]
    mockGetLSPStatus.mockResolvedValue(mockServers)
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(3)
    expect(result.current.data?.[0].status).toBe('connected')
    expect(result.current.data?.[1].status).toBe('error')
    expect(result.current.data?.[2].status).toBe('connected')
  })

  it('should handle API errors', async () => {
    mockGetLSPStatus.mockRejectedValue(new Error('Failed to fetch LSP status'))
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeTruthy()
  })

  it('should have 30s refetch interval', async () => {
    mockGetLSPStatus.mockResolvedValue([])
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const observer = queryClient.getQueryCache().find({ queryKey: ['opencode', 'lsp', 'http://localhost:5551', '/test'] })
    expect((observer?.options as any).refetchInterval).toBe(30000)
  })

  it('should have 10s stale time', async () => {
    mockGetLSPStatus.mockResolvedValue([])
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const observer = queryClient.getQueryCache().find({ queryKey: ['opencode', 'lsp', 'http://localhost:5551', '/test'] })
    expect((observer?.options as any).staleTime).toBe(10000)
  })

  it('should refetch on window focus', async () => {
    mockGetLSPStatus.mockResolvedValue([])
    vi.mocked(useOpenCodeClient).mockReturnValue(mockClient)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useLSPStatus('http://localhost:5551', '/test'), {
      wrapper
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const observer = queryClient.getQueryCache().find({ queryKey: ['opencode', 'lsp', 'http://localhost:5551', '/test'] })
    expect((observer?.options as any).refetchOnWindowFocus).toBe(true)
  })
})
