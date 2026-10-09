import type { SessionMessageAssistantTool, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_OPEN_WALKTHROUGH_ACTION, WalkthroughSourceSchema } from '@opencode-manager/shared/schemas'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'

interface OpenWalkthroughCall {
  id: string
  source?: WalkthroughSource
}

/**
 * Reads the optional walkthrough source the agent passed to `open_walkthrough`, ignoring anything that
 * does not validate as a `WalkthroughSource`.
 */
function readOpenWalkthroughSource(params: unknown): WalkthroughSource | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined
  const parsed = WalkthroughSourceSchema.safeParse((params as Record<string, unknown>).source)
  return parsed.success ? parsed.data : undefined
}

/**
 * Reads an assistant tool part as a completed `ocm` `open_walkthrough` call, or undefined for every
 * other tool, action, and unfinished state. The call carries the validated source the agent asked to
 * open, or undefined when none was given or it did not validate.
 */
export function readOpenWalkthroughCall(
  part: SessionMessageAssistantTool,
): OpenWalkthroughCall | undefined {
  if (part.name !== MANAGER_TOOL_NAME || part.state.status !== 'completed') return undefined
  if (part.state.input.action !== MANAGER_TOOL_OPEN_WALKTHROUGH_ACTION) return undefined
  return { id: part.id, source: readOpenWalkthroughSource(part.state.input.params) }
}

/** Every completed `open_walkthrough` call in a transcript, in message order. */
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
