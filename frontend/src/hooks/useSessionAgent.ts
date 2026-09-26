import { useMemo, useEffect } from 'react'
import { useSession, useAgents } from './useOpenCode'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'

interface AgentInfo {
  id: string
  name?: string
  mode?: string
  hidden?: boolean
}

const getPrimaryAgents = (agents: AgentInfo[] | undefined): AgentInfo[] => {
  return agents?.filter(
    (agent) => (agent.mode === 'primary' || agent.mode === 'all') && !agent.hidden
  ) ?? []
}

const resolveAvailableAgentId = (
  agentId: string | undefined,
  agents: AgentInfo[] | undefined,
  agentsLoaded: boolean
): string | undefined => {
  if (!agentId) return undefined
  if (!agentsLoaded) return agentId

  const normalizedAgentId = agentId.toLowerCase()
  return getPrimaryAgents(agents).find(
    (agent) => agent.id.toLowerCase() === normalizedAgentId
  )?.id
}

export function resolveDefaultSessionAgent(
  agents: AgentInfo[] | undefined,
  agentsLoaded: boolean
): string {
  const primaryAgents = getPrimaryAgents(agents)

  if (agentsLoaded && primaryAgents.length > 0) {
    return primaryAgents[0].id
  }

  return 'build'
}

interface SessionAgentResult {
  agent: string
  model: { providerID: string; modelID: string } | undefined
  variant: string | undefined
}

export function useSessionAgent(
  sessionID: string | undefined,
  directory?: string
) {
  const { data: session } = useSession(sessionID, directory)
  const { data: agents, isSuccess: agentsLoaded } = useAgents(directory)
  const storedAgent = useSessionAgentStore((s) => s.agents[sessionID ?? ''] ?? null)
  const setAgent = useSessionAgentStore((s) => s.setAgent)

  const defaultAgent = useMemo(
    () => resolveDefaultSessionAgent(agents, agentsLoaded),
    [agents, agentsLoaded]
  )

  const sessionAgent = resolveAvailableAgentId(session?.agent, agents, agentsLoaded)
  const fallbackAgent = resolveAvailableAgentId(storedAgent ?? undefined, agents, agentsLoaded)

  const result = useMemo<SessionAgentResult>(() => {
    const model = session?.model
      ? { providerID: session.model.providerID, modelID: session.model.id }
      : undefined

    return {
      agent: sessionAgent ?? fallbackAgent ?? defaultAgent,
      model,
      variant: session?.model?.variant,
    }
  }, [sessionAgent, fallbackAgent, defaultAgent, session?.model])

  useEffect(() => {
    if (session?.agent && sessionID) {
      setAgent(sessionID, session.agent)
    }
  }, [session?.agent, sessionID, setAgent])

  return { agent: result.agent, model: result.model, variant: result.variant }
}
