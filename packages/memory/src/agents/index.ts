import type { AgentRole, AgentDefinition } from './types'
import { codeAgent } from './code'
import { memoryAgent } from './memory'
import { architectAgent } from './architect'
import { codeReviewAgent } from './code-review'

export const agents: Record<AgentRole, AgentDefinition> = {
  code: codeAgent,
  memory: memoryAgent,
  architect: architectAgent,
  'code-review': codeReviewAgent,
}

export { type AgentRole, type AgentDefinition, type AgentConfig } from './types'
