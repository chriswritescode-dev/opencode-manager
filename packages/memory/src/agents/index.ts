import type { AgentRole, AgentDefinition, AgentRegistry } from './types'
import { codeAgent } from './code'
import { reviewAgent } from './review'
import { memoryAgent } from './memory'

export const agents: Record<AgentRole, AgentDefinition> = {
  code: codeAgent,
  review: reviewAgent,
  memory: memoryAgent,
}

export function getAgent(role: AgentRole): AgentDefinition | undefined {
  return agents[role]
}

export function getAgentById(id: string): AgentDefinition | undefined {
  return Object.values(agents).find((agent) => agent.id === id)
}

export function getAllAgents(): AgentDefinition[] {
  return Object.values(agents)
}

export function hasAgent(role: AgentRole): boolean {
  return role in agents
}

export function createAgentRegistry(): AgentRegistry {
  return {
    get: getAgent,
    getAll: getAllAgents,
    has: hasAgent,
  }
}

export { type AgentRole, type AgentDefinition, type AgentRegistry, type AgentConfig } from './types'
