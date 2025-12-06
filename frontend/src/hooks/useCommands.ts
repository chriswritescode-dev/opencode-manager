import { useState, useEffect } from 'react'
import { createOpenCodeClient } from '@/api/opencode'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

// Built-in OpenCode commands
const BUILTIN_COMMANDS: CommandType[] = [
  {
    name: 'help',
    description: 'Show the help dialog',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'init',
    description: 'Create or update AGENTS.md file',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'new',
    description: 'Start a new session',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'clear',
    description: 'Start a new session (alias for /new)',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'sessions',
    description: 'List and switch between sessions',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'resume',
    description: 'List and switch between sessions (alias for /sessions)',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'continue',
    description: 'List and switch between sessions (alias for /sessions)',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'models',
    description: 'List available models',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'themes',
    description: 'List available themes',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'share',
    description: 'Share current session',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'unshare',
    description: 'Unshare current session',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'export',
    description: 'Export current conversation to Markdown',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'compact',
    description: 'Compact the current session',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'summarize',
    description: 'Compact the current session (alias for /compact)',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'undo',
    description: 'Undo last message in the conversation',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'redo',
    description: 'Redo a previously undone message',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'details',
    description: 'Toggle tool execution details',
    template: '',
    agent: '',
    model: '',
    subtask: false
  },
  {
    name: 'editor',
    description: 'Open external editor for composing messages',
    template: '',
    agent: '',
    model: '',
    subtask: false
  }
]

export function useCommands(opcodeUrl: string | null) {
  const [commands, setCommands] = useState<CommandType[]>(BUILTIN_COMMANDS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opcodeUrl) return

    const fetchCommands = async () => {
      setLoading(true)
      setError(null)
      
      try {
        const client = createOpenCodeClient(opcodeUrl)
        const commandList = await client.listCommands()
        const allCommands = [...BUILTIN_COMMANDS, ...commandList]
        const uniqueCommands = allCommands.filter((command, index, self) =>
          index === self.findIndex((c) => c.name === command.name)
        )
        setCommands(uniqueCommands)
      } catch (err) {
        console.error('Failed to fetch commands:', err)
        setError('Failed to load commands')
        setCommands(BUILTIN_COMMANDS)
      } finally {
        setLoading(false)
      }
    }

    fetchCommands()
  }, [opcodeUrl])

  const filterCommands = (query: string) => {
    if (!query.trim()) return commands
    
    const searchTerm = query.toLowerCase()
    return commands.filter(command =>
      command.name.toLowerCase().includes(searchTerm)
    )
  }

  return {
    commands,
    loading,
    error,
    filterCommands
  }
}