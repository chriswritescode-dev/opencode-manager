import { useMemo } from 'react'
import { useMessages } from './useOpenCode'
import type { components } from '@/api/opencode-types'

type UserMessage = components['schemas']['UserMessage']

const DEFAULT_AGENT = 'plan'

export function useSessionAgent(
  opcodeUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string
) {
  const { data: messages } = useMessages(opcodeUrl, sessionID, directory)

  return useMemo(() => {
    if (!messages || messages.length === 0) {
      return {
        agent: DEFAULT_AGENT,
        model: undefined as { providerID: string; modelID: string } | undefined,
        variant: undefined as string | undefined,
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info.role === 'user') {
        const userInfo = msg.info as UserMessage
        return {
          agent: userInfo.agent || DEFAULT_AGENT,
          model: userInfo.model,
          variant: userInfo.variant,
        }
      }
    }

    return {
      agent: DEFAULT_AGENT,
      model: undefined,
      variant: undefined,
    }
  }, [messages])
}

export function getSessionAgentFromMessages(
  messages: Array<{ info: { role: string; agent?: string } }> | undefined
): string {
  if (!messages || messages.length === 0) {
    return DEFAULT_AGENT
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role === 'user' && 'agent' in msg.info) {
      return (msg.info.agent as string) || DEFAULT_AGENT
    }
  }

  return DEFAULT_AGENT
}
