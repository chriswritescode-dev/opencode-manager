import { useMemo, useEffect } from 'react'
import { useSession, useAgents } from './useOpenCode'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import { getPrimaryAgents } from '@/lib/primaryAgents'
import type { AgentInfo, ModelRef } from '@opencode-manager/shared/opencode'

type SessionAgentInfo = Pick<AgentInfo, 'id' | 'mode' | 'hidden'>

/**
 * Resolves a requested agent id to its canonical primary-agent id, or `undefined` when it is
 * absent or no longer selectable. Before the agent list loads the id passes through unchanged.
 */
const resolveAvailableAgentId = (
  agentId: string | undefined,
  agents: SessionAgentInfo[] | undefined,
  agentsLoaded: boolean
): string | undefined => {
  if (!agentId) return undefined
  if (!agentsLoaded) return agentId

  const normalizedAgentId = agentId.toLowerCase()
  return getPrimaryAgents(agents).find(
    (agent) => agent.id.toLowerCase() === normalizedAgentId
  )?.id
}

/**
 * Returns the first primary agent id once agents have loaded, falling back to `build` while
 * loading or when no primary agent is available.
 */
export function resolveDefaultSessionAgent(
  agents: SessionAgentInfo[] | undefined,
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
  sessionAgentId: string | undefined
  modelRef: ModelRef | undefined
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
      sessionAgentId: session?.agent,
      modelRef: session?.model,
    }
  }, [sessionAgent, fallbackAgent, defaultAgent, session?.model, session?.agent])

  useEffect(() => {
    if (session?.agent && sessionID) {
      setAgent(sessionID, session.agent)
    }
  }, [session?.agent, sessionID, setAgent])

  return {
    agent: result.agent,
    model: result.model,
    variant: result.variant,
    sessionAgentId: result.sessionAgentId,
    modelRef: result.modelRef,
  }
}
