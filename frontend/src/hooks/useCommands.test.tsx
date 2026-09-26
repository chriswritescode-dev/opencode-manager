import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCommands } from './useCommands'
import { listCommands } from '../api/opencode'

vi.mock('../api/opencode', () => ({
  listCommands: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns built-in commands in alphabetical order when disabled', () => {
    const { result } = renderHook(() => useCommands({ enabled: false }), { wrapper: createWrapper() })

    expect(result.current.filterCommands('').map(command => command.name).slice(0, 5)).toEqual([
      'clear',
      'compact',
      'continue',
      'details',
      'editor',
    ])
    expect(listCommands).not.toHaveBeenCalled()
  })

  it('prioritizes exact and prefix matches before other matches', () => {
    const { result } = renderHook(() => useCommands({ enabled: false }), { wrapper: createWrapper() })

    expect(result.current.filterCommands('co').map(command => command.name)).toEqual([
      'compact',
      'continue',
    ])
    expect(result.current.filterCommands('do').map(command => command.name)).toEqual([
      'redo',
      'undo',
    ])
  })

  it('sorts loaded custom commands with built-in commands', async () => {
    vi.mocked(listCommands).mockResolvedValue([
      { name: 'zebra', description: 'Zebra' },
      { name: 'alpha', description: 'Alpha' },
    ])

    const { result } = renderHook(() => useCommands({ directory: '/repo' }), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.filterCommands('').map(command => command.name).slice(0, 3)).toEqual([
        'alpha',
        'clear',
        'compact',
      ])
    })

    expect(listCommands).toHaveBeenCalledWith('/repo')
  })
})
