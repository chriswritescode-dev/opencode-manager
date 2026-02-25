import type { Logger, PlanningState, PreCompactionSnapshot, CompactionConfig } from '../types'
import type { MemoryService } from '../services/memory'
import type { SessionStateService } from '../services/session-state'
import type { PluginInput } from '@opencode-ai/plugin'
import {
  buildCustomCompactionPrompt,
  formatPlanningState,
  formatCompactionDiagnostics,
  estimateTokens,
  trimToTokenBudget,
  extractCompactionSummary,
} from './compaction-utils'

export interface SessionHooks {
  onMessage: (input: unknown, output: unknown) => Promise<void>
  onEvent: (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>
  onCompacting: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string }
  ) => Promise<void>
}

interface ChatMessageInput {
  sessionID?: string
}

interface EventInput {
  event: {
    type: string
    properties?: Record<string, unknown>
  }
}

interface CompactingInput {
  sessionID: string
  branch?: string
}

interface CompactingOutput {
  context: string[]
  prompt?: string
}

const LOGGED_EVENTS = new Set(['session.compacted', 'session.status', 'session.updated', 'session.created'])

function formatEventProperties(props?: Record<string, unknown>): string {
  if (!props) return ''
  try {
    return ' ' + JSON.stringify(props)
  } catch {
    return ''
  }
}

function buildSubtaskPrompt(sessionId: string, compactionSummary: string): string {
  return `Review the following compaction summary and extract any project knowledge worth preserving across sessions.

---
${compactionSummary}
---

For each item found, store it with the appropriate scope:
- convention: coding style rules, naming patterns, workflow preferences
- decision: architectural choices with their rationale
- context: project structure, key file locations, domain knowledge, known issues

Also extract any planning state (phases, objectives, progress, blockers). If found, use memory-planning-update with sessionID "${sessionId}" to store it.

Be selective — only store knowledge useful in future sessions. Check for duplicates before writing (use memory-read to search first). 

End your response with:
1. A brief summary of what was stored
2. Whether there was active work in progress (in-progress todos, pending tasks, or incomplete planning phases). If so, tell the main agent to review the planning state and todo list and continue where it left off.`
}

const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  customPrompt: true,
  inlinePlanning: true,
  maxContextTokens: 4000,
  snapshotToKV: true,
}

export function createSessionHooks(
  projectId: string,
  memoryService: MemoryService,
  sessionStateService: SessionStateService,
  logger: Logger,
  ctx: PluginInput,
  config?: CompactionConfig
): SessionHooks {
  const initializedSessions = new Set<string>()
  const compactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...config }

  async function runPostCompactionFlow(sessionId: string): Promise<void> {
    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionId },
      query: { limit: 4 },
    })

    const messages = messagesResult.data as unknown as Array<{
      info: { role: string }
      parts: Array<{ type: string; text?: string }>
    }>
    const compactionSummary = extractCompactionSummary(messages ?? [])
    if (!compactionSummary) {
      logger.log(`Post-compaction: no summary found in session ${sessionId}, skipping extraction`)
      return
    }

    logger.log(`Post-compaction: fetched compaction summary (${compactionSummary.length} chars)`)

    await ctx.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [
          {
            type: 'subtask',
            agent: 'Memory',
            description: 'Memory extraction after compaction',
            prompt: buildSubtaskPrompt(sessionId, compactionSummary),
          },
        ],
      },
    })

    logger.log(`Post-compaction: extraction and resumption complete for session ${sessionId}`)
  }

  return {
    async onMessage(input, _output) {
      const chatInput = input as ChatMessageInput
      const sessionId = chatInput.sessionID
      if (!sessionId) return
      if (!initializedSessions.has(sessionId)) {
        logger.log(`Session initialized: ${sessionId} (project ${projectId})`)
        initializedSessions.add(sessionId)
      }
    },
    async onEvent(input: EventInput) {
      const { event } = input
      if (event && LOGGED_EVENTS.has(event.type)) {
        logger.log(`Event received: ${event.type}${formatEventProperties(event.properties)}`)
      }
      if (event?.type !== 'session.compacted') return

      const sessionId = (event.properties?.sessionId as string) ??
                        (event.properties?.sessionID as string)
      if (!sessionId) {
        logger.log(`session.compacted event missing sessionId`)
        return
      }

      logger.log(`Session compacted for project ${projectId} - starting isolated extraction`)

      runPostCompactionFlow(sessionId).catch((err) => {
        logger.error(`Post-compaction flow failed: ${err}`)
      })
    },
    async onCompacting(input: CompactingInput, output: CompactingOutput) {
      const { sessionID: sessionId, branch } = input
      logger.log(`Compacting hook fired for project ${projectId}, session ${sessionId}`)

      try {
        const sections: string[] = []
        let totalTokens = 0

        let planningState: PlanningState | null = null
        if (compactionConfig.inlinePlanning) {
          planningState = sessionStateService.getPlanningState(sessionId)
          if (planningState) {
            const planningText = formatPlanningState(planningState)
            if (planningText) {
              sections.push(`## Planning State\n${planningText}`)
              totalTokens += estimateTokens(planningText)
            }
            logger.log(`Compacting: fetched planning state for session ${sessionId}`)
          }
        }

        if (compactionConfig.snapshotToKV) {
          const priorSnapshot = sessionStateService.getCompactionSnapshot(sessionId)
          if (priorSnapshot) {
            const snapshotParts: string[] = []
            snapshotParts.push(`Last compaction: ${new Date(priorSnapshot.timestamp).toLocaleString()}`)
            if (priorSnapshot.branch) {
              snapshotParts.push(`branch: ${priorSnapshot.branch}`)
            }
            if (priorSnapshot.planningState) {
              const priorPlanningText = formatPlanningState(priorSnapshot.planningState)
              if (priorPlanningText) {
                snapshotParts.push(`\n### Prior Planning State:\n${priorPlanningText}`)
              }
            }
            sections.push(`## Prior Session Context\n${snapshotParts.join('\n')}`)
            totalTokens += estimateTokens(snapshotParts.join('\n'))
            logger.log(`Compacting: fetched prior snapshot for session ${sessionId}`)
          }
        }

        const [convMemories, decMemories] = await Promise.all([
          memoryService.listByProject(projectId, { scope: 'convention', limit: 10 }),
          memoryService.listByProject(projectId, { scope: 'decision', limit: 10 }),
        ])

        const allMemories = [...convMemories, ...decMemories]
        logger.log(`Compacting: fetched ${allMemories.length} memories (conv=${convMemories.length}, dec=${decMemories.length})`)

        if (allMemories.length > 0) {
          const formatScope = (items: typeof allMemories, scope: string) =>
            items.filter(m => m.scope === scope).map(m => `- ${m.content}`).join('\n')

          const conv = formatScope(allMemories, 'convention')
          if (conv) sections.push(`### Conventions\n${conv}`)

          const dec = formatScope(allMemories, 'decision')
          if (dec) sections.push(`### Decisions\n${dec}`)
        }

        const maxTokens = compactionConfig.maxContextTokens ?? 4000

        let trimmedSections = [...sections]
        let currentTokens = totalTokens

        for (let i = trimmedSections.length - 1; i >= 0; i--) {
          const sectionTokens = estimateTokens(trimmedSections[i]!)
          if (currentTokens + sectionTokens > maxTokens) {
            const priority = i === 0 ? 'high' : i <= 1 ? 'medium' : 'low'
            trimmedSections[i] = trimToTokenBudget(trimmedSections[i]!, maxTokens - currentTokens, priority)
          }
          currentTokens += estimateTokens(trimmedSections[i]!)
        }

        trimmedSections = trimmedSections.filter(s => s.length > 0)

        if (trimmedSections.length === 0) return

        const contextText = `## Project Memory\n\nPreserve these established facts during compaction:\n\n${trimmedSections.join('\n\n')}`
        output.context.push(contextText)

        if (compactionConfig.customPrompt) {
          output.prompt = buildCustomCompactionPrompt()
          logger.log(`Compacting: set custom compaction prompt`)
        }

        if (compactionConfig.snapshotToKV) {
          try {
            const snapshot: PreCompactionSnapshot = {
              timestamp: new Date().toISOString(),
              sessionId,
              planningState: planningState ?? undefined,
              branch,
            }
            sessionStateService.setCompactionSnapshot(sessionId, projectId, snapshot)
            logger.log(`Compacting: stored pre-compaction snapshot`)
          } catch (error) {
            logger.error(`Failed to store pre-compaction snapshot: ${error}`)
          }
        }

        const diagnostics = formatCompactionDiagnostics({
          planningPhases: planningState?.phases?.length ?? 0,
          conventions: convMemories.length,
          decisions: decMemories.length,
          tokensInjected: estimateTokens(trimmedSections.join('\n\n')),
        })
        if (diagnostics) {
          output.context.push(diagnostics)
        }

        logger.log(`Compacting: injected ${trimmedSections.length} context sections`)
      } catch (error) {
        logger.error(`Compacting hook failed: ${error}`)
      }
    },
  }
}
