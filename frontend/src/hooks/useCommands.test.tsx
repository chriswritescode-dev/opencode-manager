import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCommands } from './useCommands'
import { listCommands } from '../api/opencode'
import { BUILTIN_COMMANDS } from '@/lib/builtinCommands'
import { useRecentCommandsStore } from '@/stores/recentCommandsStore'

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
    useRecentCommandsStore.setState({ names: [] })
  })

  it('returns the built-in commands sorted by name when disabled', () => {
    const { result } = renderHook(() => useCommands({ enabled: false }), { wrapper: createWrapper() })

    const names = result.current.searchCommands('').map(({ item }) => item.name)

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    for (const command of BUILTIN_COMMANDS) {
      expect(names).toContain(command.name)
    }
    expect(names).not.toContain('themes')
    expect(names).not.toContain('share')
    expect(names).not.toContain('unshare')
    expect(names).not.toContain('editor')
    expect(listCommands).not.toHaveBeenCalled()
  })

  it('prioritizes exact and prefix matches before other matches', () => {
    const { result } = renderHook(() => useCommands({ enabled: false }), { wrapper: createWrapper() })

    expect(result.current.searchCommands('co').map(({ item }) => item.name)).toEqual([
      'compact',
      'connect',
      'continue',
      'copy',
    ])
    expect(result.current.searchCommands('do').map(({ item }) => item.name)).toEqual([
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
      expect(result.current.searchCommands('').map(({ item }) => item.name).slice(0, 3)).toEqual([
        'agent',
        'alpha',
        'btw',
      ])
    })

    expect(listCommands).toHaveBeenCalledWith('/repo')
  })

  it('lets a loaded command override a built-in command with the same name', async () => {
    vi.mocked(listCommands).mockResolvedValue([{ name: 'copy', description: 'server copy' }])

    const { result } = renderHook(() => useCommands({ directory: '/repo' }), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.searchCommands('copy').map(({ item }) => item)).toEqual([
        { name: 'copy', description: 'server copy' },
      ])
    })

    const copy = result.current.findCommand('copy')!
    expect('action' in copy).toBe(false)
  })

  it('ranks an exact built-in match ahead of a server command that contains it', async () => {
    vi.mocked(listCommands).mockResolvedValue([{ name: 'xundo', description: 'X undo' }])

    const { result } = renderHook(() => useCommands({ directory: '/repo' }), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.commands.some(command => command.name === 'xundo')).toBe(true)
    })

    expect(result.current.searchCommands('undo').map(({ item }) => item.name)).toEqual([
      'undo',
      'xundo',
      'redo',
    ])
  })

  it('lists recent commands first for an empty query and uses recency to break ties', () => {
    useRecentCommandsStore.setState({ names: ['copy', 'undo'] })
    const { result } = renderHook(() => useCommands({ enabled: false }), { wrapper: createWrapper() })

    expect(result.current.searchCommands('').map(({ item }) => item.name).slice(0, 2)).toEqual(['copy', 'undo'])
    expect(result.current.searchCommands('co').map(({ item }) => item.name)).toEqual([
      'copy',
      'compact',
      'connect',
      'continue',
    ])
  })

  it('matches command descriptions after name matches', async () => {
    vi.mocked(listCommands).mockResolvedValue([{ name: 'ship', description: 'Deploy a preview build' }])
    const { result } = renderHook(() => useCommands({ directory: '/repo' }), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.searchCommands('preview').map(({ item }) => item.name)).toEqual(['ship'])
    })
  })

  it('finds only exact command names, ignoring case', () => {
    const { result } = renderHook(() => useCommands({ enabled: false }), { wrapper: createWrapper() })

    expect(result.current.findCommand('UNDO')?.name).toBe('undo')
    expect(result.current.findCommand('und')).toBeUndefined()
  })
})
