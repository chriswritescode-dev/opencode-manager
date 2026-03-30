import { tool } from '@opencode-ai/plugin'
import type { ToolContext } from './types'

const z = tool.schema

export function createKvTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  const { kvService, projectId, logger } = ctx

  return {
    'memory-kv-set': tool({
      description: 'Store a key-value pair for the current project. Values expire after 7 days by default. Use for ephemeral project state like planning progress, code review patterns, or session context.',
      args: {
        key: z.string().describe('The key to store the value under'),
        value: z.string().describe('The value to store (JSON string)'),
        ttlMs: z.number().optional().describe('Time-to-live in milliseconds (default: 7 days)'),
      },
      execute: async (args) => {
        logger.log(`memory-kv-set: key="${args.key}"`)
        let parsed: unknown
        try {
          parsed = JSON.parse(args.value)
        } catch {
          parsed = args.value
        }
        kvService.set(projectId, args.key, parsed, args.ttlMs)
        const expiresAt = new Date(Date.now() + (args.ttlMs ?? 7 * 24 * 60 * 60 * 1000))
        logger.log(`memory-kv-set: stored key="${args.key}", expires=${expiresAt.toISOString()}`)
        return `Stored key "${args.key}" (expires ${expiresAt.toISOString()})`
      },
    }),

    'memory-kv-get': tool({
      description: 'Retrieve a value by key for the current project.',
      args: {
        key: z.string().describe('The key to retrieve'),
      },
      execute: async (args) => {
        logger.log(`memory-kv-get: key="${args.key}"`)
        const value = kvService.get(projectId, args.key)
        if (value === null) {
          logger.log(`memory-kv-get: key="${args.key}" not found`)
          return `No value found for key "${args.key}"`
        }
        logger.log(`memory-kv-get: key="${args.key}" found`)
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      },
    }),

    'memory-kv-list': tool({
      description: 'List all active key-value pairs for the current project. Optionally filter by key prefix.',
      args: {
        prefix: z.string().optional().describe('Filter entries by key prefix (e.g. "review-finding:")'),
      },
      execute: async (args) => {
        logger.log(`memory-kv-list: prefix="${args.prefix ?? 'none'}"`)
        const entries = args.prefix
          ? kvService.listByPrefix(projectId, args.prefix)
          : kvService.list(projectId)
        if (entries.length === 0) {
          logger.log('memory-kv-list: no entries')
          return 'No active KV entries for this project.'
        }
        const formatted = entries.map((e) => {
          const expiresIn = Math.round((e.expiresAt - Date.now()) / 60000)
          const dataStr = typeof e.data === 'string' ? e.data : JSON.stringify(e.data)
          const preview = dataStr.substring(0, 50).replace(/\n/g, ' ')
          return `- **${e.key}** (expires in ${expiresIn}m): ${preview}${dataStr.length > 50 ? '...' : ''}`
        })
        logger.log(`memory-kv-list: ${entries.length} entries`)
        return `${entries.length} active KV entries:\n\n${formatted.join('\n')}`
      },
    }),

    'memory-kv-delete': tool({
      description: 'Delete a key-value pair for the current project.',
      args: {
        key: z.string().describe('The key to delete'),
      },
      execute: async (args) => {
        logger.log(`memory-kv-delete: key="${args.key}"`)
        kvService.delete(projectId, args.key)
        return `Deleted key "${args.key}"`
      },
    }),
  }
}
