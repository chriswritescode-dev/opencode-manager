import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listCommands } from '@/api/opencode'
import type { CommandInfo } from '@opencode-manager/shared/opencode'
import { BUILTIN_COMMANDS } from '@/lib/builtinCommands'
import { rankByMatch } from '@/lib/fuzzyMatch'
import { useRecentCommandsStore } from '@/stores/recentCommandsStore'

function sortCommandsByName(commands: CommandInfo[]): CommandInfo[] {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name))
}

const SORTED_BUILTIN_COMMANDS = sortCommandsByName([...BUILTIN_COMMANDS])

interface UseCommandsOptions {
  directory?: string
  enabled?: boolean
}

export function useCommands(options: UseCommandsOptions = {}) {
  const { directory, enabled = true } = options
  const recentNames = useRecentCommandsStore((state) => state.names)

  const { data: commands, isLoading: loading, error } = useQuery({
    queryKey: ['opencode', 'commands', directory ?? null],
    queryFn: async () => {
      const loaded = await listCommands(directory)
      const allCommands = [...loaded, ...BUILTIN_COMMANDS]
      const uniqueCommands = allCommands.filter((command, index, self) =>
        index === self.findIndex((c) => c.name === command.name)
      )
      return sortCommandsByName(uniqueCommands)
    },
    enabled,
    initialData: SORTED_BUILTIN_COMMANDS,
    initialDataUpdatedAt: 0,
  })

  const searchCommands = useCallback((query: string) => rankByMatch(commands, query, {
    getName: (command) => command.name,
    getDescription: (command) => command.description,
    recent: recentNames,
  }), [commands, recentNames])

  const findCommand = useCallback((name: string) => {
    const lowerName = name.toLowerCase()
    return commands.find((command) => command.name.toLowerCase() === lowerName)
  }, [commands])

  return {
    commands,
    recentNames,
    loading,
    error: error ? 'Failed to load commands' : null,
    searchCommands,
    findCommand,
  }
}
