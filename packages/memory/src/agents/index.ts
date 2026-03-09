import type { AgentRole, AgentDefinition } from './types'
import { codeAgent } from './code'
import { librarianAgent } from './librarian'
import { architectAgent } from './architect'
import { auditorAgent } from './auditor'

export const agents: Record<AgentRole, AgentDefinition> = {
  code: codeAgent,
  librarian: librarianAgent,
  architect: architectAgent,
  auditor: auditorAgent,
}

export { type AgentRole, type AgentDefinition, type AgentConfig } from './types'
