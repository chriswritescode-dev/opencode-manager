import type { SessionMessageAssistant, ToolContent } from '@opencode/client'

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>\s*/g

export function sessionIDFromEvent(event: { data: unknown }): string | undefined {
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  if (!('sessionID' in data) || typeof data.sessionID !== 'string') return undefined
  return data.sessionID
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
