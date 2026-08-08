import type { MessageWithParts } from '../api/types'
import { useSendErrorStore } from '../stores/sendErrorStore'

const getUserMessageText = (message: MessageWithParts): string => {
  if (message.info.role !== 'user') return ''
  return message.parts
    .map((part) => (part.type === 'text' ? part.text || '' : ''))
    .join('')
    .trim()
}

const hasUserMessageText = (messages: MessageWithParts[], prompt: string): boolean => {
  const expected = prompt.trim()
  if (!expected) return false
  return messages.some((message) => getUserMessageText(message) === expected)
}

/**
 * Strict backstop for clearing stale send state when a prompt is confirmed delivered.
 *
 * The SSE `message.updated` handler is the realtime authority and clears send errors
 * unconditionally because it only receives message metadata (text parts stream in
 * separately). This helper runs against a fully fetched message list — where text parts
 * are present — and clears only when the failed/queued prompt text actually appears,
 * recovering sessions whose confirming SSE events were missed (e.g. backgrounded tab).
 */
export const reconcileConfirmedPrompt = (sessionID: string, messages: MessageWithParts[]): void => {
  const sendErrorStore = useSendErrorStore.getState()
  const sendError = sendErrorStore.getError(sessionID)
  const queuedPrompt = sendErrorStore.queuedPrompts[sessionID]

  if (sendError?.kind === 'network' && sendError.failedPrompt && hasUserMessageText(messages, sendError.failedPrompt)) {
    sendErrorStore.clearNetworkError(sessionID)
  }

  if (queuedPrompt && hasUserMessageText(messages, queuedPrompt)) {
    sendErrorStore.clearQueuedPrompt(sessionID)
  }
}
