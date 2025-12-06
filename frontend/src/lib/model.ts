import type { MessageWithParts } from '@/api/types'

export function getSessionModel(
  messages: MessageWithParts[] | undefined,
  fallbackModel?: string | null
): string | null {
  const assistantMessages = messages?.filter(msg => msg.info.role === 'assistant') || []
  let latest = assistantMessages[assistantMessages.length - 1]

  if (latest?.info.role === 'assistant') {
    const tokens = latest.info.tokens.input + latest.info.tokens.output + latest.info.tokens.reasoning
    if (tokens === 0 && assistantMessages.length > 1) {
      latest = assistantMessages[assistantMessages.length - 2]
    }
  }

  if (latest?.info.role === 'assistant') {
    return `${latest.info.providerID}/${latest.info.modelID}`
  }

  return fallbackModel || null
}
