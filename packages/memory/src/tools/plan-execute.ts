import { tool } from '@opencode-ai/plugin'
import type { ToolContext } from './types'
import { parseModelString, retryWithModelFallback } from '../utils/model-fallback'
import { stripPromiseTags } from '../utils/strip-promise-tags'

const z = tool.schema

export function createPlanExecuteTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  const { directory, config, logger, v2 } = ctx

  return {
    'memory-plan-execute': tool({
      description: 'Send the plan to the Code agent for execution. By default creates a new session. Set inPlace to true to switch to the code agent in the current session (plan is already in context).',
      args: {
        plan: z.string().describe('The full implementation plan to send to the Code agent'),
        title: z.string().describe('Short title for the session (shown in session list)'),
        inPlace: z.boolean().optional().default(false).describe('Execute in the current session, instead of creating a new session'),
      },
      execute: async (args, context) => {
        logger.log(`memory-plan-execute: ${args.inPlace ? 'switching to code agent' : 'creating session'} titled "${args.title}"`)

        const sessionTitle = args.title.length > 60 ? `${args.title.substring(0, 57)}...` : args.title
        const executionModel = parseModelString(config.executionModel)

        if (args.inPlace) {
          const inPlacePrompt = `The architect agent has created an implementation plan in this conversation above. You are now the code agent taking over this session. Your job is to execute the plan — edit files, run commands, create tests, and implement every phase. Do NOT just describe or summarize the changes. Actually make them.\n\nPlan reference: ${args.plan}`

          const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
            () => v2.session.promptAsync({
              sessionID: context.sessionID,
              directory,
              agent: 'code',
              parts: [{ type: 'text' as const, text: inPlacePrompt }],
              ...(executionModel ? { model: executionModel } : {}),
            }),
            () => v2.session.promptAsync({
              sessionID: context.sessionID,
              directory,
              agent: 'code',
              parts: [{ type: 'text' as const, text: inPlacePrompt }],
            }),
            executionModel,
            logger,
          )

          if (promptResult.error) {
            logger.error(`memory-plan-execute: in-place agent switch failed`, promptResult.error)
            return `Failed to switch to code agent. Error: ${JSON.stringify(promptResult.error)}`
          }

          const modelInfo = actualModel ? `${actualModel.providerID}/${actualModel.modelID}` : 'default'
          return `Switching to code agent for execution.\n\nTitle: ${sessionTitle}\nModel: ${modelInfo}\nAgent: code`
        }

        const { cleaned: planText, stripped } = stripPromiseTags(args.plan)
        if (stripped) {
          logger.log(`memory-plan-execute: stripped <promise> tags from plan text`)
        }

        const createResult = await v2.session.create({
          title: sessionTitle,
          directory,
        })

        if (createResult.error || !createResult.data) {
          logger.error(`memory-plan-execute: failed to create session`, createResult.error)
          return 'Failed to create new session.'
        }

        const newSessionId = createResult.data.id
        logger.log(`memory-plan-execute: created session=${newSessionId}`)

        const { result: promptResult, usedModel: actualModel } = await retryWithModelFallback(
          () => v2.session.promptAsync({
            sessionID: newSessionId,
            directory,
            parts: [{ type: 'text' as const, text: planText }],
            agent: 'code',
            model: executionModel!,
          }),
          () => v2.session.promptAsync({
            sessionID: newSessionId,
            directory,
            parts: [{ type: 'text' as const, text: planText }],
            agent: 'code',
          }),
          executionModel,
          logger,
        )

        if (promptResult.error) {
          logger.error(`memory-plan-execute: failed to prompt session`, promptResult.error)
          return `Session created (${newSessionId}) but failed to send plan. Switch to it and paste the plan manually.`
        }

        logger.log(`memory-plan-execute: prompted session=${newSessionId}`)

        v2.tui.selectSession({ sessionID: newSessionId }).catch((err) => {
          logger.error('memory-plan-execute: failed to navigate TUI to new session', err)
        })

        const modelInfo = actualModel ? `${actualModel.providerID}/${actualModel.modelID}` : 'default'
        return `Implementation session created and plan sent.\n\nSession: ${newSessionId}\nTitle: ${sessionTitle}\nModel: ${modelInfo}\n\nNavigated to the new session. You can change the model from the session dropdown.`
      },
    }),
  }
}
