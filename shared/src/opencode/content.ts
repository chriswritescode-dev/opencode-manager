import type { SessionMessageAssistant, ToolContent } from '@opencode/client'
import { z } from 'zod'

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>\s*/g

const SessionEventDataSchema = z.object({ sessionID: z.string() })

export function sessionIDFromEvent(event: { data: unknown }): string | undefined {
  const data = SessionEventDataSchema.safeParse(event.data)
  return data.success ? data.data.sessionID : undefined
}

export interface AssistantTextOptions {
  stripThink?: boolean
}

export function assistantText(
  content: SessionMessageAssistant['content'] | undefined,
  options: AssistantTextOptions = {},
): string {
  const texts = (content ?? []).filter((part) => part.type === 'text').map((part) => part.text)
  if (!options.stripThink) return texts.join('\n\n')
  return texts
    .map((text) => text.replace(THINK_BLOCK_PATTERN, '').trim())
    .filter(Boolean)
    .join('\n\n')
}

export interface ToolContentTextOptions {
  separator?: string
}

export function toolContentText(
  content: readonly ToolContent[] | undefined,
  options: ToolContentTextOptions = {},
): string {
  return (content ?? [])
    .filter((entry) => entry.type === 'text')
    .map((entry) => entry.text)
    .join(options.separator ?? '\n\n')
}
