import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listCommands } from '@/api/opencode'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { serverScopedKey } from '@/lib/serverScope'
import type { CommandInfo } from '@opencode-manager/shared/opencode'
import { getBuiltinCommands } from '@/lib/builtinCommands'
import { rankByMatch } from '@/lib/fuzzyMatch'
import { useRecentCommandsStore } from '@/stores/recentCommandsStore'

function sortCommandsByName(commands: CommandInfo[]): CommandInfo[] {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name))
}

interface UseCommandsOptions {
  directory?: string
  enabled?: boolean
}

export function useCommands(options: UseCommandsOptions = {}) {
  const { directory, enabled = true } = options
  const serverId = useOpenCodeServerId()
  const recentNames = useRecentCommandsStore((state) => state.names)

  const builtinCommands = useMemo(
    () => getBuiltinCommands(isLocalOpenCodeServer(serverId)),
    [serverId],
  )
  const sortedBuiltinCommands = useMemo(() => sortCommandsByName([...builtinCommands]), [builtinCommands])

  const { data: commands, isLoading: loading, error } = useQuery({
    queryKey: serverScopedKey(['opencode', 'commands', directory ?? null], serverId),
    queryFn: async () => {
      const loaded = await listCommands(directory, serverId)
      const allCommands = [...loaded, ...builtinCommands]
      const uniqueCommands = allCommands.filter((command, index, self) =>
        index === self.findIndex((c) => c.name === command.name)
      )
      return sortCommandsByName(uniqueCommands)
    },
    enabled,
    initialData: sortedBuiltinCommands,
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
