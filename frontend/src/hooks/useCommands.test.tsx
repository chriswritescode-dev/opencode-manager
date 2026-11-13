import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CommandInfo } from '@opencode-manager/shared/opencode'
import { useCommands } from './useCommands'
import { BUILTIN_COMMANDS } from '@/lib/builtinCommands'
import { useRecentCommandsStore } from '@/stores/recentCommandsStore'
import { renderHookWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

function commandsRoute(
  resolve: (directory: string | undefined) => CommandInfo[],
  prefix = '/api/opencode/api',
): FetchRoute {
  return {
    method: 'GET',
    path: `${prefix}/command`,
    respond: (request) => ({
      json: { data: resolve(request.searchParams.get('location[directory]') ?? undefined) },
    }),
  }
}

function renderCommands(options: { directory?: string, enabled?: boolean }, routes: FetchRoute[] = []) {
  return renderHookWithProviders(() => useCommands(options), { ...hookProviders, fetchRoutes: routes })
}

function names(commands: Array<{ item: { name: string } }>): string[] {
  return commands.map(({ item }) => item.name)
}

describe('useCommands', () => {
  it('returns the built-in commands sorted by name when disabled', () => {
    const { result, fetchFake } = renderCommands({ enabled: false })

    const commandNames = names(result.current.searchCommands(''))

    expect(commandNames).toEqual([...commandNames].sort((a, b) => a.localeCompare(b)))
    for (const command of BUILTIN_COMMANDS) {
      expect(commandNames).toContain(command.name)
    }
    expect(commandNames).not.toContain('themes')
    expect(commandNames).not.toContain('share')
    expect(commandNames).not.toContain('unshare')
    expect(commandNames).not.toContain('editor')
    expect(fetchFake.requests).toHaveLength(0)
  })

  it('prioritizes exact and prefix matches before other matches', () => {
    const { result } = renderCommands({ enabled: false })

    expect(names(result.current.searchCommands('co'))).toEqual(['compact', 'connect', 'continue', 'copy'])
    expect(names(result.current.searchCommands('do'))).toEqual(['redo', 'undo'])
  })

  it('sorts loaded custom commands with built-in commands', async () => {
    const { result, fetchFake } = renderCommands({ directory: '/repo' }, [
      commandsRoute(() => [
        { name: 'zebra', description: 'Zebra' },
        { name: 'alpha', description: 'Alpha' },
      ]),
    ])

    await waitFor(() => {
      expect(names(result.current.searchCommands('')).slice(0, 3)).toEqual(['agent', 'alpha', 'btw'])
    })

    expect(fetchFake.lastRequest('GET', '/api/opencode/api/command')?.searchParams.get('location[directory]')).toBe(
      '/repo',
    )
  })

  it('lets a loaded command override a built-in command with the same name', async () => {
    const { result } = renderCommands({ directory: '/repo' }, [
      commandsRoute(() => [{ name: 'copy', description: 'server copy' }]),
    ])

    await waitFor(() => {
      expect(result.current.searchCommands('copy').map(({ item }) => item)).toEqual([
        { name: 'copy', description: 'server copy' },
      ])
    })

    const copy = result.current.findCommand('copy')
    if (copy === undefined) throw new Error('expected the loaded copy command')
    expect('action' in copy).toBe(false)
  })

  it('ranks an exact built-in match ahead of a server command that contains it', async () => {
    const { result } = renderCommands({ directory: '/repo' }, [
      commandsRoute(() => [{ name: 'xundo', description: 'X undo' }]),
    ])

    await waitFor(() => {
      expect(result.current.findCommand('xundo')).toBeDefined()
    })

    expect(names(result.current.searchCommands('undo'))).toEqual(['undo', 'xundo', 'redo'])
  })

  it('lists recent commands first for an empty query and uses recency to break ties', () => {
    useRecentCommandsStore.setState({ names: ['copy', 'undo'] })
    const { result } = renderCommands({ enabled: false })

    expect(names(result.current.searchCommands('')).slice(0, 2)).toEqual(['copy', 'undo'])
    expect(names(result.current.searchCommands('co'))).toEqual(['copy', 'compact', 'connect', 'continue'])
  })

  it('matches command descriptions after name matches', async () => {
    const { result } = renderCommands({ directory: '/repo' }, [
      commandsRoute(() => [{ name: 'ship', description: 'Deploy a preview build' }]),
    ])

    await waitFor(() => {
      expect(names(result.current.searchCommands('preview'))).toEqual(['ship'])
    })
  })

  it('loads commands for a newly selected directory even when queries have a stale time', async () => {
    let directory = '/repo-a'
    const { result, rerender, fetchFake } = renderHookWithProviders(() => useCommands({ directory }), {
      ...hookProviders,
      fetchRoutes: [
        commandsRoute((selected) => [
          { name: selected === '/repo-b' ? 'from-b' : 'from-a', description: '' },
        ]),
      ],
    })

    await waitFor(() => expect(result.current.findCommand('from-a')).toBeDefined())

    directory = '/repo-b'
    rerender()

    await waitFor(() => expect(result.current.findCommand('from-b')).toBeDefined())
    expect(
      fetchFake.findRequests('GET', '/api/opencode/api/command').map(
        (request) => request.searchParams.get('location[directory]'),
      ),
    ).toEqual(['/repo-a', '/repo-b'])
  })

  it('finds only exact command names, ignoring case', () => {
    const { result } = renderCommands({ enabled: false })

    expect(result.current.findCommand('UNDO')?.name).toBe('undo')
    expect(result.current.findCommand('und')).toBeUndefined()
  })

  it.each([
    {
      title: 'a linked server',
      serverId: 'srv_kitchen',
      present: ['sessions', 'resume', 'continue', 'mcp', 'skills', 'models', 'compact'],
      absent: ['walkthrough'],
    },
    {
      title: 'the local server',
      serverId: 'local',
      present: ['sessions', 'mcp', 'skills', 'walkthrough'],
      absent: [],
    },
  ])('keeps the right built-ins for $title', ({ serverId, present, absent }) => {
    const { result } = renderHookWithProviders(() => useCommands({ enabled: false }), {
      ...hookProviders,
      serverId,
    })

    const commandNames = names(result.current.searchCommands(''))

    for (const name of present) {
      expect(commandNames).toContain(name)
    }
    for (const name of absent) {
      expect(commandNames).not.toContain(name)
    }
    expect(result.current.findCommand('mcp')).toBeDefined()
  })
})
