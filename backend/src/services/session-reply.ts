import {
  assistantText,
  sessionIDFromEvent,
  type OpenCodeApi,
  type SessionMessageAssistant,
  type SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import { truncateText } from '../utils/text-truncate'
import type { OpenCodeClient } from './opencode/client'
import { sseAggregator, type SSEEvent } from './sse-aggregator'

export const SESSION_REPLY_MAX_LENGTH = 20000

export const SESSION_REPLY_TRUNCATION_MARKER = '\n\n[reply truncated]'

export interface AssistantReplyState {
  responseText: string | null
  errorText: string | null
  completed: boolean
}

export interface SessionSettleSignal {
  errorText: string | null
}

export function truncateSessionReply(text: string): string {
  return truncateText(text, SESSION_REPLY_MAX_LENGTH, SESSION_REPLY_TRUNCATION_MARKER).text
}

export function sessionSettleSignal(event: SSEEvent, sessionId: string): SessionSettleSignal | null {
  if (sessionIDFromEvent(event) !== sessionId) {
    return null
  }

  switch (event.type) {
    case 'session.execution.failed':
      return { errorText: event.data.error.message || 'The session reported an unknown error.' }
    case 'session.execution.interrupted':
      return { errorText: 'The session execution was interrupted.' }
    case 'session.idle':
    case 'session.execution.succeeded':
      return { errorText: null }
    case 'session.status':
      return event.data.status.type === 'idle' ? { errorText: null } : null
    default:
      return null
  }
}

export function waitForSessionSettled(client: OpenCodeClient, sessionId: string, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: () => void = () => {}

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      unsubscribe()
      resolve()
    }

    unsubscribe = sseAggregator.onEvent((_directory, event) => {
      if (sessionSettleSignal(event, sessionId)) {
        finish()
      }
    })

    timer = setTimeout(finish, timeoutMs)

    void isSessionBusy(client, sessionId)
      .then((busy) => {
        if (!busy) {
          finish()
        }
      })
      .catch(() => {
        finish()
      })
  })
}

export function getLatestAssistantReplyState(messages: SessionMessageInfo[]): AssistantReplyState | null {
  const assistantMessage = messages.find(
    (message): message is SessionMessageAssistant => message.type === 'assistant',
  )

  if (!assistantMessage) {
    return null
  }

  return {
    responseText: assistantText(assistantMessage.content, { stripThink: true }) || null,
    errorText: assistantMessage.error?.message ?? null,
    completed: Boolean(assistantMessage.time.completed),
  }
}

export async function readLatestAssistantReply(client: OpenCodeClient, sessionId: string): Promise<AssistantReplyState | null> {
  const response = await client.api.message.list({
    sessionID: sessionId,
    order: 'desc',
    limit: 20,
  })
  return getLatestAssistantReplyState(response.data)
}

export type ActiveSessions = Awaited<ReturnType<OpenCodeApi['session']['active']>>

export function isSessionBusyIn(active: ActiveSessions, sessionId: string): boolean {
  return sessionId in active
}

export async function isSessionBusy(client: OpenCodeClient, sessionId: string): Promise<boolean> {
  return isSessionBusyIn(await client.api.session.active(), sessionId)
}
