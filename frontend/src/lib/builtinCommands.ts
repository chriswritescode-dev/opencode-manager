import type { CommandInfo } from '@opencode-manager/shared/opencode'

export const BUILTIN_COMMAND_ACTIONS = [
  'showSessions',
  'showModels',
  'newSession',
  'toggleDetails',
  'exportSession',
  'copyTranscript',
  'compact',
  'askSideQuestion',
  'renameSession',
  'forkSession',
  'jumpToMessage',
  'undo',
  'redo',
  'cycleAgent',
  'cycleVariant',
  'showMcp',
  'showSkills',
  'showSettings',
  'connectProvider',
  'showWalkthrough',
] as const

type BuiltinCommandAction = (typeof BUILTIN_COMMAND_ACTIONS)[number]

type CommandActionHandler = (argument: string) => void | Promise<void>

export type CommandActions = Record<BuiltinCommandAction, CommandActionHandler>

export type PageCommandActions = Omit<CommandActions, 'cycleAgent' | 'cycleVariant'>

interface BuiltinCommand extends CommandInfo {
  action: BuiltinCommandAction
  keepsPrompt?: boolean
}

export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = [
  { name: 'help', description: 'Show the help dialog', action: 'showSettings' },
  { name: 'new', description: 'Start a new session', action: 'newSession' },
  { name: 'clear', description: 'Start a new session (alias for /new)', action: 'newSession' },
  { name: 'sessions', description: 'List and switch between sessions', action: 'showSessions' },
  { name: 'resume', description: 'List and switch between sessions (alias for /sessions)', action: 'showSessions' },
  { name: 'continue', description: 'List and switch between sessions (alias for /sessions)', action: 'showSessions' },
  { name: 'models', description: 'List available models', action: 'showModels' },
  { name: 'model', description: 'Choose a model', action: 'showModels' },
  { name: 'agent', description: 'Switch to the next primary agent', action: 'cycleAgent' },
  { name: 'variants', description: 'Cycle the model reasoning variant', action: 'cycleVariant' },
  { name: 'export', description: 'Export current conversation to Markdown', action: 'exportSession' },
  { name: 'copy', description: 'Copy the session transcript to the clipboard', action: 'copyTranscript' },
  { name: 'compact', description: 'Compact the current session', action: 'compact' },
  { name: 'btw', description: 'Ask a side question without adding it to the conversation', action: 'askSideQuestion' },
  { name: 'rename', description: 'Rename the session, or regenerate its title when no title is given', action: 'renameSession' },
  { name: 'fork', description: 'Fork the session from a chosen message', action: 'forkSession' },
  { name: 'timeline', description: 'Jump to a message in the conversation', action: 'jumpToMessage' },
  { name: 'undo', description: 'Undo last message in the conversation', action: 'undo', keepsPrompt: true },
  { name: 'redo', description: 'Redo a previously undone message', action: 'redo', keepsPrompt: true },
  { name: 'details', description: 'Toggle tool execution details', action: 'toggleDetails' },
  { name: 'mcp', description: 'Manage MCP servers', action: 'showMcp' },
  { name: 'skills', description: 'Load a skill', action: 'showSkills' },
  { name: 'walkthrough', description: 'Walk through the session changes, explained step by step', action: 'showWalkthrough' },
  { name: 'settings', description: 'Open settings', action: 'showSettings' },
  { name: 'connect', description: 'Connect a provider', action: 'connectProvider' },
]

export function isBuiltinCommand(command: CommandInfo): command is BuiltinCommand {
  return 'action' in command
}
