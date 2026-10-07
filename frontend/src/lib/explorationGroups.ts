import type { SessionMessageAssistant, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'

type AssistantContentPart = SessionMessageAssistant['content'][number]

export type AssistantContentItem =
  | { type: 'part'; part: AssistantContentPart }
  | { type: 'exploration'; parts: SessionMessageAssistantTool[] }

const EXPLORATION_TOOLS = new Set(['read', 'glob', 'grep', 'webfetch', 'websearch'])

function isExplorationTool(part: AssistantContentPart): part is SessionMessageAssistantTool {
  return part.type === 'tool' && EXPLORATION_TOOLS.has(part.name.toLowerCase())
}

function isInvisiblePart(part: AssistantContentPart, showReasoning: boolean): boolean {
  if (part.type === 'text') return part.text.trim().length === 0
  if (part.type === 'reasoning') return !showReasoning || part.text.trim().length === 0
  return false
}

/**
 * Collapses consecutive read, search, and fetch tool calls into exploration groups, matching the
 * OpenCode TUI. Parts that render nothing are dropped so they do not split a run.
 */
export function groupExplorationParts(
  content: SessionMessageAssistant['content'],
  showReasoning: boolean,
): AssistantContentItem[] {
  return content.reduce<AssistantContentItem[]>((items, part) => {
    if (isInvisiblePart(part, showReasoning)) return items
    const previous = items.at(-1)
    if (!isExplorationTool(part)) items.push({ type: 'part', part })
    else if (previous?.type === 'exploration') previous.parts.push(part)
    else items.push({ type: 'exploration', parts: [part] })
    return items
  }, [])
}

/** Whether every tool in an exploration group has finished, successfully or not. */
export function isExplorationComplete(parts: SessionMessageAssistantTool[]): boolean {
  return parts.every((part) => part.state.status === 'completed' || part.state.status === 'error')
}

/** TUI-style summary such as `Explored: 5 reads, 2 searches`. */
export function explorationLabel(parts: SessionMessageAssistantTool[]): string {
  const counts = new Map<string, number>()
  parts.forEach((part) => {
    const tool = part.name.toLowerCase()
    const noun = tool === 'grep' || tool === 'glob' || tool === 'websearch' ? 'search' : tool === 'webfetch' ? 'fetch' : tool
    counts.set(noun, (counts.get(noun) ?? 0) + 1)
  })
  const names = [...counts].map(([noun, count]) =>
    `${count} ${count === 1 ? noun : noun === 'search' || noun === 'fetch' ? `${noun}es` : `${noun}s`}`,
  )
  return `${isExplorationComplete(parts) ? 'Explored' : 'Exploring'}: ${names.join(', ')}`
}
