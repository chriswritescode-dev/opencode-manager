#!/usr/bin/env bun
import { parseGlobalOptions, getGitProjectId, resolveProjectIdByName } from './utils'

interface CommandModule {
  cli: (args: string[], globalOpts: { dbPath?: string; resolvedProjectId?: string }) => Promise<void> | void
  help: () => void | Promise<void>
}

const commands: Record<string, CommandModule> = {
  export: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/export')
      cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/export')
      help()
    },
  },
  import: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/import')
      cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/import')
      help()
    },
  },
  list: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/list')
      cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/list')
      help()
    },
  },
  stats: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/stats')
      cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/stats')
      help()
    },
  },
  cleanup: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/cleanup')
      await cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/cleanup')
      help()
    },
  },
  upgrade: {
    cli: async (args, globalOpts) => {
      const { run } = await import('./commands/upgrade')
      await run()
    },
    help: async () => {
      const { help } = await import('./commands/upgrade')
      help()
    },
  },
  status: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/status')
      await cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/status')
      help()
    },
  },
  cancel: {
    cli: async (args, globalOpts) => {
      const { cli } = await import('./commands/cancel')
      await cli(args, globalOpts)
    },
    help: async () => {
      const { help } = await import('./commands/cancel')
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
  upgrade   Check for and install plugin updates
  status    Show Ralph loop status
  cancel    Cancel a Ralph loop

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

  const resolvedProjectId = globalOpts.projectId
    ? resolveProjectId(globalOpts.projectId)
    : getGitProjectId(globalOpts.dir) ?? undefined

  await command.cli(commandArgs, {
    dbPath: globalOpts.dbPath,
    resolvedProjectId,
  })
}

runCli().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
