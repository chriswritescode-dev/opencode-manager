import { useMemo, useRef, useEffect } from 'react'
import { useMessages } from './useOpenCode'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import type { components } from '@/api/opencode-types'

type UserMessage = components['schemas']['UserMessage']

const DEFAULT_AGENT = 'build'

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
  const { data: messages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionID, directory)
  const storedAgent = useSessionAgentStore((s) => s.agents[sessionID ?? ''] ?? null)
  const setAgent = useSessionAgentStore((s) => s.setAgent)
  const prevRef = useRef<SessionAgentResult>({ agent: DEFAULT_AGENT, model: undefined, variant: undefined })

  const result = useMemo(() => {
    if (storedAgent) {
      let model: { providerID: string; modelID: string } | undefined
      let variant: string | undefined

      if (messages && messages.length > 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msgWithParts = messages[i]
          if (msgWithParts.info.role === 'user') {
            const userInfo = msgWithParts.info as UserMessage
            model = userInfo.model
            variant = userInfo.variant
            break
          }
        }
      }

      const prev = prevRef.current
      if (
        prev.agent === storedAgent &&
        prev.variant === variant &&
        prev.model?.providerID === model?.providerID &&
        prev.model?.modelID === model?.modelID
      ) {
        return prev
      }

      const next: SessionAgentResult = { agent: storedAgent, model, variant }
      prevRef.current = next
      return next
    }

    if (messagesLoading) {
      return { agent: DEFAULT_AGENT, model: undefined, variant: undefined }
    }

    if (!messages || messages.length === 0) {
      return { agent: DEFAULT_AGENT, model: undefined, variant: undefined }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgWithParts = messages[i]
      if (msgWithParts.info.role === 'user') {
        const userInfo = msgWithParts.info as UserMessage
        if (userInfo.agent) {
          const prev = prevRef.current
          if (
            prev.agent === userInfo.agent &&
            prev.variant === userInfo.variant &&
            prev.model?.providerID === userInfo.model?.providerID &&
            prev.model?.modelID === userInfo.model?.modelID
          ) {
            return prev
          }

          const next: SessionAgentResult = {
            agent: userInfo.agent,
            model: userInfo.model,
            variant: userInfo.variant,
          }
          prevRef.current = next
          return next
        }
      }
    }

    return { agent: DEFAULT_AGENT, model: undefined, variant: undefined }
  }, [messages, messagesLoading, storedAgent])

  useEffect(() => {
    if (result.agent && sessionID) {
      setAgent(sessionID, result.agent)
    }
  }, [result.agent, sessionID, setAgent])

  return result
}

export function getSessionAgentFromMessages(
  messages: Array<{ role: string; agent?: string }> | undefined
): string | undefined {
  if (!messages || messages.length === 0) {
    return undefined
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && 'agent' in msg && msg.agent) {
      return msg.agent
    }
  }

  return undefined
}
