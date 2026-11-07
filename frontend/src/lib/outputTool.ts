import type { SessionMessageAssistantTool, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import {
  MANAGER_TOOL_NAME,
  MANAGER_TOOL_OPEN_OUTPUT_ACTION,
  MANAGER_TOOL_PUBLISH_OUTPUT_ACTION,
  OutputDefinitionIdSchema,
  OutputParamsSchema,
} from '@opencode-manager/shared/schemas'
import type { OutputParams } from '@opencode-manager/shared/schemas'

const OPEN_OUTPUT_ACTIONS: ReadonlySet<string> = new Set([
  MANAGER_TOOL_OPEN_OUTPUT_ACTION,
  MANAGER_TOOL_PUBLISH_OUTPUT_ACTION,
])

/** A completed `ocm` call that asks the client to open an output definition. */
export interface OpenOutputCall {
  id: string
  definitionId: string
  params?: OutputParams
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads an assistant tool part as a completed `ocm` call that asks the client to open an output, or
 * undefined for every other tool, action, and unfinished state. The call carries the validated
 * definition id and the validated params the agent passed, if any.
 */
export function readOpenOutputCall(part: SessionMessageAssistantTool): OpenOutputCall | undefined {
  if (part.name !== MANAGER_TOOL_NAME || part.state.status !== 'completed') return undefined
  const action = part.state.input.action
  if (typeof action !== 'string' || !OPEN_OUTPUT_ACTIONS.has(action)) return undefined
  const raw = part.state.input.params
  if (!isPlainObject(raw)) return undefined
  const definitionId = OutputDefinitionIdSchema.safeParse(raw.definitionId)
  if (!definitionId.success) return undefined
  const params = OutputParamsSchema.safeParse(raw.params)
  return {
    id: part.id,
    definitionId: definitionId.data,
    params: params.success ? params.data : undefined,
  }
}

/** Every completed `ocm` open-output call in a transcript, in message order. */
export function collectOpenOutputCalls(messages: SessionMessageInfo[]): OpenOutputCall[] {
  const calls: OpenOutputCall[] = []
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool') continue
      const call = readOpenOutputCall(part)
      if (call) calls.push(call)
    }
  }
  return calls
}
