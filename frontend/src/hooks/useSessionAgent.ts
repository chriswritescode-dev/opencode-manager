import { useMemo, useRef, useEffect } from 'react'
import { useMessages, useConfig, useAgents } from './useOpenCode'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import type { components } from '@/api/opencode-types'

type UserMessage = components['schemas']['UserMessage']

interface AgentInfo {
  name: string
  mode?: string
  hidden?: boolean
}

export function resolveDefaultSessionAgent(
  configDefaultAgent: string | undefined,
  agents: AgentInfo[] | undefined,
  agentsLoaded: boolean
): string {
  const primaryAgents = agents?.filter(
    (agent) => (agent.mode === 'primary' || agent.mode === 'all') && !agent.hidden
  ) ?? []

  if (configDefaultAgent) {
    const normalizedConfig = configDefaultAgent.toLowerCase()
    const configInPrimary = primaryAgents.some(
      (agent) => agent.name.toLowerCase() === normalizedConfig
    )
    if (!agentsLoaded || configInPrimary) {
      return configDefaultAgent
    }
  }

  if (agentsLoaded && primaryAgents.length > 0) {
    return primaryAgents[0].name
  }

  return 'build'
}

interface SessionAgentResult {
  agent: string
  model: { providerID: string; modelID: string } | undefined
  variant: string | undefined
  fromMessage: boolean
}

export function useSessionAgent(
  opcodeUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string
) {
  const { data: messages, isLoading: messagesLoading, isFetching: messagesFetching } = useMessages(opcodeUrl, sessionID, directory)
  const { data: config } = useConfig(opcodeUrl, directory)
  const { data: agents, isSuccess: agentsLoaded } = useAgents(opcodeUrl, directory)
  const storedAgent = useSessionAgentStore((s) => s.agents[sessionID ?? ''] ?? null)
  const setAgent = useSessionAgentStore((s) => s.setAgent)
  const prevRef = useRef<SessionAgentResult>({ agent: 'build', model: undefined, variant: undefined, fromMessage: false })

  const defaultAgent = useMemo(
    () => resolveDefaultSessionAgent(config?.default_agent, agents, agentsLoaded),
    [config?.default_agent, agents, agentsLoaded]
  )

  const result = useMemo(() => {
    if (messagesLoading || messagesFetching) {
      return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
    }

    if (!messages || messages.length === 0) {
      return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
    }

    let latestAgent: string | undefined
    let latestModel: { providerID: string; modelID: string } | undefined
    let latestVariant: string | undefined

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgWithParts = messages[i]
      if (msgWithParts.info.role === 'user') {
        const userInfo = msgWithParts.info as UserMessage
        if (userInfo.agent) {
          latestAgent = userInfo.agent
          latestModel = userInfo.model
          latestVariant = userInfo.variant
          break
        }
      }
    }

    if (latestAgent) {
      const prev = prevRef.current
      if (
        prev.agent === latestAgent &&
        prev.variant === latestVariant &&
        prev.model?.providerID === latestModel?.providerID &&
        prev.model?.modelID === latestModel?.modelID
      ) {
        return { ...prev, fromMessage: true }
      }

      const next: SessionAgentResult = {
        agent: latestAgent,
        model: latestModel,
        variant: latestVariant,
        fromMessage: true,
      }
      prevRef.current = next
      return next
    }

    if (storedAgent) {
      const prev = prevRef.current
      if (
        prev.agent === storedAgent &&
        prev.variant === latestVariant &&
        prev.model?.providerID === latestModel?.providerID &&
        prev.model?.modelID === latestModel?.modelID
      ) {
        return { ...prev, fromMessage: false }
      }

      const next: SessionAgentResult = { agent: storedAgent, model: latestModel, variant: latestVariant, fromMessage: false }
      prevRef.current = next
      return next
    }

    return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
  }, [messages, messagesLoading, messagesFetching, storedAgent, defaultAgent])

  useEffect(() => {
    if (result.agent && sessionID && result.fromMessage) {
      setAgent(sessionID, result.agent)
    }
  }, [result.agent, result.fromMessage, sessionID, setAgent])

  return { agent: result.agent, model: result.model, variant: result.variant }
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
