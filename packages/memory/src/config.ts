import type { AgentRole, AgentDefinition, AgentConfig } from './agents'

const REPLACED_BUILTIN_AGENTS = ['build']

const ENHANCED_BUILTIN_AGENTS: Record<string, { tools: Record<string, boolean> }> = {
  plan: {
    tools: {
      'memory-read': true,
      'memory-planning-update': true,
      'memory-planning-get': true,
    },
  },
}

export function createConfigHandler(agents: Record<AgentRole, AgentDefinition>) {
  return async (config: Record<string, unknown>) => {
    const agentConfigs = createAgentConfigs(agents)

    const userAgentConfigs = config.agent as Record<string, AgentConfig> | undefined
    const mergedAgents = { ...agentConfigs }

    if (userAgentConfigs) {
      for (const [name, userConfig] of Object.entries(userAgentConfigs)) {
        if (mergedAgents[name]) {
          mergedAgents[name] = { ...mergedAgents[name], ...userConfig }
        } else {
          mergedAgents[name] = userConfig
        }
      }
    }

    for (const name of REPLACED_BUILTIN_AGENTS) {
      mergedAgents[name] = { ...mergedAgents[name], hidden: true }
    }

    for (const [name, enhancement] of Object.entries(ENHANCED_BUILTIN_AGENTS)) {
      const existing = mergedAgents[name] as AgentConfig | undefined
      const existingTools = existing?.tools ?? {}
      mergedAgents[name] = {
        ...existing,
        tools: { ...existingTools, ...enhancement.tools },
      } as AgentConfig
    }

    config.agent = mergedAgents
    config.default_agent = 'Code'
  }
}

function createAgentConfigs(agents: Record<AgentRole, AgentDefinition>): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}

  for (const agent of Object.values(agents)) {
    const tools: Record<string, boolean> = {}
    if (agent.tools?.exclude) {
      for (const tool of agent.tools.exclude) {
        tools[tool] = false
      }
    }

    result[agent.displayName] = {
      description: agent.description,
      model: agent.defaultModel ?? '',
      prompt: agent.systemPrompt ?? '',
      mode: agent.mode ?? 'subagent',
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
      ...(agent.variant ? { variant: agent.variant } : {}),
      ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
      ...(agent.maxSteps !== undefined ? { maxSteps: agent.maxSteps } : {}),
      ...(agent.hidden ? { hidden: agent.hidden } : {}),
    }
  }

  return result
}
