import { type SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { getAssistantText } from '@/hooks/useAutoPlayLastResponse'

export function collectVisibleAssistantTexts(
  container: HTMLElement,
  messages: SessionMessageInfo[],
  bottomInset: number,
): string[] {
  const containerRect = container.getBoundingClientRect()
  const textById = new Map(
    messages
      .filter((message) => message.type === 'assistant')
      .map((message) => [message.id, getAssistantText(message).trim()]),
  )
  return Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > containerRect.top && rect.top < containerRect.bottom - bottomInset
    })
    .map((element) => textById.get(element.dataset.messageId ?? '') ?? '')
    .filter((text) => text.length > 0)
}
