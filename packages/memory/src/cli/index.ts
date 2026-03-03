#!/usr/bin/env bun
import { parseGlobalOptions, getGitProjectId, resolveProjectIdByName } from './utils'

interface CommandModule {
  run: (args: string[], globalOpts: { dbPath?: string; projectId?: string }) => Promise<void>
  help: () => void | Promise<void>
}

const commands: Record<string, CommandModule> = {
  export: {
    run: async (args, globalOpts) => {
      const { run } = await import('./commands/export')
      run(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/export')
      help()
    },
  },
  import: {
    run: async (args, globalOpts) => {
      const { run } = await import('./commands/import')
      run(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/import')
      help()
    },
  },
  list: {
    run: async (args, globalOpts) => {
      const { run } = await import('./commands/list')
      run(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/list')
      help()
    },
  },
  stats: {
    run: async (args, globalOpts) => {
      const { run } = await import('./commands/stats')
      run(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/stats')
      help()
    },
  },
  cleanup: {
    run: async (args, globalOpts) => {
      const { run } = await import('./commands/cleanup')
      run(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/cleanup')
      help()
    },
  },
}

function printMainHelp(): void {
  console.log(`
OpenCode Memory CLI

Usage:
  ocm-mem <command> [options]

Commands:
  export    Export memories to file (JSON or Markdown)
  import    Import memories from file
  list      List projects with memory counts
  stats     Show memory statistics
  cleanup   Delete memories by criteria

Global Options:
  --db-path <path>       Path to memory database
  --project, -p <name>   Project name or SHA (auto-detected from git)
  --dir, -d <path>       Git repo path for project detection
  --help, -h             Show help

Run '<command> --help' for more information on a command.
  `.trim())
}

function resolveProjectId(input: string): string {
  const isSha = /^[0-9a-f]{40}$/.test(input)
  if (isSha) return input

  return resolveProjectIdByName(input) || input
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || (args.length === 1 && (args[0] === 'help' || args[0] === '--help' || args[0] === '-h'))) {
    printMainHelp()
    process.exit(0)
  }

  const hasHelpFlag = (arr: string[]) => arr.includes('--help') || arr.includes('-h')

  if (hasHelpFlag(args) && args.length === 1) {
    printMainHelp()
    process.exit(0)
  }

  const { globalOpts, remainingArgs } = parseGlobalOptions(args)
  const commandName = remainingArgs[0]

  if (!commandName) {
    printMainHelp()
    process.exit(0)
  }

  const command = commands[commandName]

  if (!command) {
    console.error(`Unknown command: ${commandName}`)
    printMainHelp()
    process.exit(1)
  }

  if (globalOpts.help) {
    await command.help()
    process.exit(0)
  }

  const commandArgs = remainingArgs.slice(1)

  if (hasHelpFlag(commandArgs)) {
    await command.help()
    process.exit(0)
  }

  let finalProjectId = globalOpts.projectId
    ? resolveProjectId(globalOpts.projectId)
    : getGitProjectId(globalOpts.dir)

  const effectiveGlobalOpts: { dbPath?: string; projectId?: string } = {
    ...globalOpts,
  }

  if (finalProjectId) {
    effectiveGlobalOpts.projectId = finalProjectId
  }

  await command.run(commandArgs, effectiveGlobalOpts)
}

runCli().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
