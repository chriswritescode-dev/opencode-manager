import type {
  ExperimentalSessionStatsInput,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStatsInfo,
} from '@opencode-manager/shared/opencode'
import { listSessionMessages } from './opencode'
import { callOpenCode } from './opencodeApi'

export const SESSION_USAGE_PAGE_LIMIT = 200
export const SESSION_USAGE_MAX_PAGES = 5

export interface SessionUsageMessages {
  steps: SessionMessageAssistant[]
  truncated: boolean
}

export async function getSessionStats(
  input: ExperimentalSessionStatsInput,
  serverId?: string,
): Promise<SessionStatsInfo> {
  return callOpenCode((api) => api.experimental.session.stats(input), serverId)
}

function isAssistantMessage(message: SessionMessageInfo): message is SessionMessageAssistant {
  return message.type === 'assistant'
}

export async function loadSessionUsageMessages(
  sessionID: string,
  serverId?: string,
): Promise<SessionUsageMessages> {
  const steps: SessionMessageAssistant[] = []
  let cursor: string | undefined

  for (let page = 0; page < SESSION_USAGE_MAX_PAGES; page += 1) {
    const result = await listSessionMessages(
      sessionID,
      { limit: SESSION_USAGE_PAGE_LIMIT, type: 'assistant', cursor },
      serverId,
    )
    steps.unshift(...result.messages.filter(isAssistantMessage))
    if (result.nextCursor === undefined || result.messages.length < SESSION_USAGE_PAGE_LIMIT) {
      return { steps, truncated: false }
    }
    cursor = result.nextCursor
  }

  return { steps, truncated: true }
}
