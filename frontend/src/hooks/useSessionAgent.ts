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

const getPrimaryAgents = (agents: AgentInfo[] | undefined): AgentInfo[] => {
  return agents?.filter(
    (agent) => (agent.mode === 'primary' || agent.mode === 'all') && !agent.hidden
  ) ?? []
}

const resolveAvailableAgentName = (
  agentName: string | undefined,
  agents: AgentInfo[] | undefined,
  agentsLoaded: boolean
): string | undefined => {
  if (!agentName) return undefined
  if (!agentsLoaded) return agentName

  const normalizedAgentName = agentName.toLowerCase()
  return getPrimaryAgents(agents).find(
    (agent) => agent.name.toLowerCase() === normalizedAgentName
  )?.name
}

export function resolveDefaultSessionAgent(
  configDefaultAgent: string | undefined,
  agents: AgentInfo[] | undefined,
  agentsLoaded: boolean
): string {
  const primaryAgents = getPrimaryAgents(agents)

  const resolvedConfigAgent = resolveAvailableAgentName(configDefaultAgent, agents, agentsLoaded)
  if (resolvedConfigAgent) {
    return resolvedConfigAgent
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
  const { data: messages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionID, directory)
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
    const resolveFallback = (): SessionAgentResult => {
      const resolvedStoredAgent = resolveAvailableAgentName(storedAgent, agents, agentsLoaded)
      if (resolvedStoredAgent) {
        const prev = prevRef.current
        if (prev.agent === resolvedStoredAgent && !prev.model && !prev.variant) {
          return { ...prev, fromMessage: false }
        }

        const next: SessionAgentResult = { agent: resolvedStoredAgent, model: undefined, variant: undefined, fromMessage: false }
        prevRef.current = next
        return next
      }

      return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
    }

    if (messagesLoading && (!messages || messages.length === 0)) {
      return resolveFallback()
    }

    if (!messages || messages.length === 0) {
      return resolveFallback()
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

    const resolvedLatestAgent = resolveAvailableAgentName(latestAgent, agents, agentsLoaded)
    if (resolvedLatestAgent) {
      const prev = prevRef.current
      if (
        prev.agent === resolvedLatestAgent &&
        prev.variant === latestVariant &&
        prev.model?.providerID === latestModel?.providerID &&
        prev.model?.modelID === latestModel?.modelID
      ) {
        return { ...prev, fromMessage: true }
      }

      const next: SessionAgentResult = {
        agent: resolvedLatestAgent,
        model: latestModel,
        variant: latestVariant,
        fromMessage: true,
      }
      prevRef.current = next
      return next
    }

    const resolvedStoredAgent = resolveAvailableAgentName(storedAgent, agents, agentsLoaded)
    if (resolvedStoredAgent) {
      const prev = prevRef.current
      if (
        prev.agent === resolvedStoredAgent &&
        prev.variant === latestVariant &&
        prev.model?.providerID === latestModel?.providerID &&
        prev.model?.modelID === latestModel?.modelID
      ) {
        return { ...prev, fromMessage: false }
      }

      const next: SessionAgentResult = { agent: resolvedStoredAgent, model: latestModel, variant: latestVariant, fromMessage: false }
      prevRef.current = next
      return next
    }

    return { agent: defaultAgent, model: undefined, variant: undefined, fromMessage: false }
  }, [messages, messagesLoading, storedAgent, defaultAgent, agents, agentsLoaded])

  useEffect(() => {
    if (result.agent && sessionID && result.fromMessage) {
      setAgent(sessionID, result.agent)
    }
  }, [result.agent, result.fromMessage, sessionID, setAgent])

  return { agent: result.agent, model: result.model, variant: result.variant }
}
