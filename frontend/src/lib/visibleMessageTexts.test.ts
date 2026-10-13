import { describe, expect, it } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
} from '@opencode-manager/shared/opencode'
import { collectVisibleAssistantTexts } from './visibleMessageTexts'

const assistantMessage = (id: string, texts: string[]): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'test-agent',
  model: { providerID: 'test-provider', id: 'test-model' },
  content: texts.map((text) => ({ type: 'text', text })),
  time: { created: 1, completed: 2 },
})

const userMessage = (id: string, text: string): SessionMessageUser => ({
  id,
  type: 'user',
  text,
  time: { created: 1 },
})

const rect = (top: number, bottom: number): DOMRect => ({
  top,
  bottom,
  left: 0,
  right: 100,
  width: 100,
  height: bottom - top,
  x: 0,
  y: top,
  toJSON: () => ({}),
} as DOMRect)

const stubRect = (element: HTMLElement, top: number, bottom: number) => {
  element.getBoundingClientRect = () => rect(top, bottom)
}

const buildContainer = (): HTMLDivElement => {
  const container = document.createElement('div')
  stubRect(container, 0, 100)
  return container
}

const appendMessageElement = (
  container: HTMLElement,
  messageId: string,
  top: number,
  bottom: number,
): HTMLElement => {
  const element = document.createElement('div')
  element.dataset.messageId = messageId
  stubRect(element, top, bottom)
  container.appendChild(element)
  return element
}

describe('collectVisibleAssistantTexts', () => {
  it('returns only intersecting assistant messages in DOM order', () => {
    const container = buildContainer()
    appendMessageElement(container, 'a1', 10, 30)
    appendMessageElement(container, 'u2', 40, 60)
    appendMessageElement(container, 'a3', 70, 90)
    appendMessageElement(container, 'a4', 200, 220)
    appendMessageElement(container, 'a5', 5, 8)

    const messages: SessionMessageInfo[] = [
      assistantMessage('a1', ['one']),
      userMessage('u2', 'hello'),
      assistantMessage('a3', []),
      assistantMessage('a4', ['four']),
      assistantMessage('a5', ['five']),
    ]

    expect(collectVisibleAssistantTexts(container, messages)).toEqual(['one', 'five'])
  })

  it('ignores user and system messages and assistant messages with no text parts', () => {
    const container = buildContainer()
    appendMessageElement(container, 'u1', 10, 30)
    appendMessageElement(container, 's1', 20, 40)
    appendMessageElement(container, 'a-empty', 30, 50)
    appendMessageElement(container, 'a-valid', 40, 60)

    const messages: SessionMessageInfo[] = [
      userMessage('u1', 'hello'),
      { id: 's1', type: 'system', text: 'note', time: { created: 1 } },
      assistantMessage('a-empty', []),
      assistantMessage('a-valid', ['kept']),
    ]

    expect(collectVisibleAssistantTexts(container, messages)).toEqual(['kept'])
  })

  it('returns an empty list when nothing intersects', () => {
    const container = buildContainer()
    appendMessageElement(container, 'a1', 200, 220)

    const messages: SessionMessageInfo[] = [assistantMessage('a1', ['hidden'])]

    expect(collectVisibleAssistantTexts(container, messages)).toEqual([])
  })
})
