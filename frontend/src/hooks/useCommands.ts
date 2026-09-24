import { useQuery } from '@tanstack/react-query'
import { listCommands } from '@/api/opencode'
import type { CommandInfo } from '@opencode-manager/shared/opencode'

function sortCommandsByName(commands: CommandInfo[]): CommandInfo[] {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name))
}

function rankCommandMatch(command: CommandInfo, searchTerm: string): number {
  const name = command.name.toLowerCase()
  if (name === searchTerm) return 0
  if (name.startsWith(searchTerm)) return 1
  return 2
}

const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: 'help', description: 'Show the help dialog' },
  { name: 'init', description: 'Create or update AGENTS.md file' },
  { name: 'new', description: 'Start a new session' },
  { name: 'clear', description: 'Start a new session (alias for /new)' },
  { name: 'sessions', description: 'List and switch between sessions' },
  { name: 'resume', description: 'List and switch between sessions (alias for /sessions)' },
  { name: 'continue', description: 'List and switch between sessions (alias for /sessions)' },
  { name: 'models', description: 'List available models' },
  { name: 'themes', description: 'List available themes' },
  { name: 'share', description: 'Share current session' },
  { name: 'unshare', description: 'Unshare current session' },
  { name: 'export', description: 'Export current conversation to Markdown' },
  { name: 'compact', description: 'Compact the current session' },
  { name: 'undo', description: 'Undo last message in the conversation' },
  { name: 'redo', description: 'Redo a previously undone message' },
  { name: 'details', description: 'Toggle tool execution details' },
  { name: 'editor', description: 'Open external editor for composing messages' },
]

const SORTED_BUILTIN_COMMANDS = sortCommandsByName(BUILTIN_COMMANDS)

interface UseCommandsOptions {
  directory?: string
  enabled?: boolean
}

export function useCommands(options: UseCommandsOptions = {}) {
  const { directory, enabled = true } = options

  const { data: commands, isLoading: loading, error } = useQuery({
    queryKey: ['opencode', 'commands', directory ?? null],
    queryFn: async () => {
      const loaded = await listCommands(directory)
      const allCommands = [...BUILTIN_COMMANDS, ...loaded]
      const uniqueCommands = allCommands.filter((command, index, self) =>
        index === self.findIndex((c) => c.name === command.name)
      )
      return sortCommandsByName(uniqueCommands)
    },
    enabled,
    initialData: SORTED_BUILTIN_COMMANDS,
  })

  const filterCommands = (query: string) => {
    if (!query.trim()) return commands

    const searchTerm = query.toLowerCase()
    return commands
      .filter(command => command.name.toLowerCase().includes(searchTerm))
      .sort((a, b) => {
        const rankDifference = rankCommandMatch(a, searchTerm) - rankCommandMatch(b, searchTerm)
        if (rankDifference !== 0) return rankDifference
        return a.name.localeCompare(b.name)
      })
  }

  return {
    commands,
    loading,
    error: error ? 'Failed to load commands' : null,
    filterCommands
  }
}
