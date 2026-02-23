export type AgentRole = 'code' | 'review' | 'memory'

export interface AgentDefinition {
  role: AgentRole
  id: string
  displayName: string
  description: string
  defaultModel?: string
  systemPrompt: string
  mode?: 'primary' | 'subagent' | 'all'
  hidden?: boolean
  tools?: {
    include?: string[]
    exclude?: string[]
  }
  variant?: string
  temperature?: number
  maxSteps?: number
}

export interface AgentRegistry {
  get(role: AgentRole): AgentDefinition | undefined
  getAll(): AgentDefinition[]
  has(role: AgentRole): boolean
}

export interface AgentConfig {
  description: string
  model: string
  prompt: string
  mode?: 'primary' | 'subagent' | 'all'
  tools?: Record<string, boolean>
  variant?: string
  temperature?: number
  maxSteps?: number
  hidden?: boolean
}
