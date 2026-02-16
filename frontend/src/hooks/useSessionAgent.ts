import { useMemo, useRef } from 'react'
import { useMessages } from './useOpenCode'
import type { components } from '@/api/opencode-types'

type UserMessage = components['schemas']['UserMessage']

const DEFAULT_AGENT = 'plan'

interface SessionAgentResult {
  agent: string
  model: { providerID: string; modelID: string } | undefined
  variant: string | undefined
}

export function useSessionAgent(
  opcodeUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string
) {
  const { data: messages } = useMessages(opcodeUrl, sessionID, directory)
  const prevRef = useRef<SessionAgentResult>({ agent: DEFAULT_AGENT, model: undefined, variant: undefined })

  return useMemo(() => {
    let agent = DEFAULT_AGENT
    let model: { providerID: string; modelID: string } | undefined
    let variant: string | undefined

    if (messages && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msgWithParts = messages[i]
        if (msgWithParts.info.role === 'user') {
          const userInfo = msgWithParts.info as UserMessage
          agent = userInfo.agent || DEFAULT_AGENT
          model = userInfo.model
          variant = userInfo.variant
          break
        }
      }
    }

    const prev = prevRef.current
    if (
      prev.agent === agent &&
      prev.variant === variant &&
      prev.model?.providerID === model?.providerID &&
      prev.model?.modelID === model?.modelID
    ) {
      return prev
    }

    const next: SessionAgentResult = { agent, model, variant }
    prevRef.current = next
    return next
  }, [messages])
}

export function getSessionAgentFromMessages(
  messages: Array<{ role: string; agent?: string }> | undefined
): string {
  if (!messages || messages.length === 0) {
    return DEFAULT_AGENT
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && 'agent' in msg) {
      return (msg.agent as string) || DEFAULT_AGENT
    }
  }

  return DEFAULT_AGENT
}
