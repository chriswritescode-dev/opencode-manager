import { JsonValueSchema, type JsonValue } from '@opencode-manager/shared/utils'
import type { SessionMessageAssistantTool, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { z } from 'zod'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_OPEN_WALKTHROUGH_ACTION, WalkthroughSourceSchema } from '@opencode-manager/shared/schemas'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'

interface OpenWalkthroughCall {
  id: string
  source?: WalkthroughSource
}

const OpenWalkthroughParamsSchema = z.looseObject({ source: JsonValueSchema.optional() })

function readOpenWalkthroughSource(params: JsonValue): WalkthroughSource | undefined {
  const parsedParams = OpenWalkthroughParamsSchema.safeParse(params)
  if (!parsedParams.success) return undefined
  const parsed = WalkthroughSourceSchema.safeParse(parsedParams.data.source)
  return parsed.success ? parsed.data : undefined
}

export function readOpenWalkthroughCall(
  part: SessionMessageAssistantTool,
): OpenWalkthroughCall | undefined {
  if (part.name !== MANAGER_TOOL_NAME || part.state.status !== 'completed') return undefined
  if (part.state.input.action !== MANAGER_TOOL_OPEN_WALKTHROUGH_ACTION) return undefined
  return { id: part.id, source: readOpenWalkthroughSource(part.state.input.params) }
}

export function collectOpenWalkthroughCalls(messages: SessionMessageInfo[]): OpenWalkthroughCall[] {
  const calls: OpenWalkthroughCall[] = []
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool') continue
      const call = readOpenWalkthroughCall(part)
      if (call) calls.push(call)
    }
  }
  return calls
}
