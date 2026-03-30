import { tool } from '@opencode-ai/plugin'
import type { ToolContext } from './types'
import { withDimensionWarning } from './types'

const z = tool.schema
const scopeEnum = z.enum(['convention', 'decision', 'context'])

interface MemoryResult {
  id: number
  projectId: string
  scope: string
  content: string
  createdAt: number
  deduplicated?: boolean
}

export function createMemoryTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  const { memoryService, projectId, logger, memoryInjection } = ctx

  return {
    'memory-read': tool({
      description: 'Search and retrieve project memories',
      args: {
        query: z.string().optional().describe('Semantic search query'),
        scope: scopeEnum.optional().describe('Filter by scope'),
        limit: z.number().optional().default(10).describe('Max results'),
      },
      execute: async (args) => {
        logger.log(`memory-read: query="${args.query ?? 'none'}", scope=${args.scope}, limit=${args.limit}`)

        let results: MemoryResult[]
        if (args.query) {
          const searchResults = await memoryService.search(args.query, projectId, {
            scope: args.scope,
            limit: args.limit,
          })
          results = searchResults.map((r) => r.memory)
        } else {
          results = memoryService.listByProject(projectId, {
            scope: args.scope,
            limit: args.limit,
          })
        }

        logger.log(`memory-read: returned ${results.length} results`)
        if (results.length === 0) {
          return withDimensionWarning(ctx.mismatchState, 'No memories found.')
        }

        const formatted = results.map(
          (m) => `[${m.id}] (${m.scope}) - Created ${new Date(m.createdAt).toISOString().split('T')[0]}\n${m.content}`
        )
        return withDimensionWarning(ctx.mismatchState, `Found ${results.length} memories:\n\n${formatted.join('\n\n')}`)
      },
    }),

    'memory-write': tool({
      description: 'Store a new project memory',
      args: {
        content: z.string().describe('The memory content to store'),
        scope: scopeEnum.describe('Memory scope category'),
      },
      execute: async (args) => {
        logger.log(`memory-write: scope=${args.scope}, content="${args.content?.substring(0, 80)}"`)

        const result = await memoryService.create({
          projectId,
          scope: args.scope,
          content: args.content,
        })

        logger.log(`memory-write: created id=${result.id}, deduplicated=${result.deduplicated}`)
        await memoryInjection.clearCache()
        return withDimensionWarning(ctx.mismatchState, `Memory stored (ID: #${result.id}, scope: ${args.scope}).${result.deduplicated ? ' (matched existing memory)' : ''}`)
      },
    }),

    'memory-edit': tool({
      description: 'Edit an existing project memory',
      args: {
        id: z.number().describe('The memory ID to edit'),
        content: z.string().describe('The updated memory content'),
        scope: scopeEnum.optional().describe('Change the scope category'),
      },
      execute: async (args) => {
        logger.log(`memory-edit: id=${args.id}, content="${args.content?.substring(0, 80)}"`)
        
        const memory = memoryService.getById(args.id)
        if (!memory || memory.projectId !== projectId) {
          logger.log(`memory-edit: id=${args.id} not found`)
          return withDimensionWarning(ctx.mismatchState, `Memory #${args.id} not found.`)
        }
        
        await memoryService.update(args.id, {
          content: args.content,
          ...(args.scope && { scope: args.scope }),
        })
        
        logger.log(`memory-edit: updated id=${args.id}`)
        await memoryInjection.clearCache()
        return withDimensionWarning(ctx.mismatchState, `Updated memory #${args.id} (scope: ${args.scope ?? memory.scope}).`)
      },
    }),

    'memory-delete': tool({
      description: 'Delete a project memory',
      args: {
        id: z.number().describe('The memory ID to delete'),
      },
      execute: async (args) => {
        const id = args.id
        logger.log(`memory-delete: id=${id}`)

        const memory = memoryService.getById(id)
        if (!memory || memory.projectId !== projectId) {
          logger.log(`memory-delete: id=${id} not found`)
          return withDimensionWarning(ctx.mismatchState, `Memory #${id} not found.`)
        }

        await memoryService.delete(id)
        await memoryInjection.clearCache()
        logger.log(`memory-delete: deleted id=${id}`)
        return withDimensionWarning(ctx.mismatchState, `Deleted memory #${id}: "${memory.content.substring(0, 50)}..." (${memory.scope})`)
      },
    }),
  }
}
