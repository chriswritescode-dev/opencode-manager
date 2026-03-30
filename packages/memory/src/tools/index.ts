import { tool } from '@opencode-ai/plugin'
import { createMemoryTools } from './memory'
import { createKvTools } from './kv'
import { createHealthTools } from './health'
import { createPlanExecuteTools } from './plan-execute'
import { createLoopTools } from './loop'
import type { ToolContext } from './types'

export { autoValidateOnLoad } from './health'
export { createToolExecuteBeforeHook, createToolExecuteAfterHook } from './plan-approval'
export { scopeEnum } from './types'
export type { ToolContext, DimensionMismatchState, InitState } from './types'

export function createTools(ctx: ToolContext): Record<string, ReturnType<typeof tool>> {
  return {
    ...createMemoryTools(ctx),
    ...createKvTools(ctx),
    ...createHealthTools(ctx),
    ...createPlanExecuteTools(ctx),
    ...createLoopTools(ctx),
  }
}
