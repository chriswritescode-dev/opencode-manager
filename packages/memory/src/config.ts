import type { AgentRole, AgentDefinition, AgentConfig } from './agents'
import type { PluginConfig } from './types'

const REPLACED_BUILTIN_AGENTS = ['build', 'plan']

const ENHANCED_BUILTIN_AGENTS: Record<string, { tools: Record<string, boolean> }> = {
  plan: {
    tools: {
      'memory-read': true,
    },
  },
}

const PLUGIN_COMMANDS: Record<string, { template: string; description: string; agent: string; subtask: boolean }> = {
  review: {
    description: 'Run a code review on current changes',
    agent: 'auditor',
    subtask: true,
    template: 'Review the current code changes. $ARGUMENTS',
  },
  'memory-loop': {
    description: 'Start a memory iterative development loop in a worktree',
    agent: 'code',
    subtask: false,
    template: `## Step 1: Prepare the Plan

Ensure you have a clear implementation plan ready.

## Step 2: Choose Execution Mode

Decide whether to run in:
- Worktree mode (isolated git worktree) for safe experimentation
- In-place mode (current directory) for quick iterations

## Step 3: Execute the Loop

Run \`memory-loop\` with:
- plan: The full implementation plan
- title: A short descriptive title
- worktree: true for worktree mode, false for in-place

The loop will automatically continue through iterations until complete.
Use \`memory-loop-status\` to check progress or \`memory-loop-cancel\` to stop.

$ARGUMENTS`,
  },
  'memory-loop-status': {
    description: 'Check status of all active memory loops',
    agent: 'code',
    subtask: true,
    template: `Check the status of all memory loops.

## Step 1: List Active Loops

Run \`memory-loop-status\` with no arguments to list all active loops for the current project.

## Step 2: Get Detailed Status

For each active loop found, run \`memory-loop-status\` with the loop name to get detailed status.

## Step 3: Report

Present a summary showing:
- Total number of active loops
- For each loop: name, status, and any additional details

If no loops are active, report that there are no active memory loops.

$ARGUMENTS`,
  },
  'memory-loop-cancel': {
    description: 'Cancel the active memory loop',
    agent: 'code',
    subtask: false,
    template: `## Step 1: Identify the Loop

Run \`memory-loop-status\` to see all active loops if you don't know the name.

## Step 2: Cancel the Loop

Run \`memory-loop-cancel\` with:
- name: The worktree name of the loop to cancel (optional if only one active)

## Step 3: Verify Cancellation

Confirm the loop was cancelled and check if worktree cleanup is needed.

$ARGUMENTS`,
  },
}

export function createConfigHandler(
  agents: Record<AgentRole, AgentDefinition>,
  agentOverrides?: Record<string, { temperature?: number }>
) {
  return async (config: Record<string, unknown>) => {
    const effectiveAgents = { ...agents }
    if (agentOverrides) {
      for (const [name, overrides] of Object.entries(agentOverrides)) {
        const role = Object.keys(effectiveAgents).find(
          (r) => effectiveAgents[r as AgentRole].displayName === name
        ) as AgentRole | undefined
        if (role) {
          effectiveAgents[role] = { ...effectiveAgents[role], ...overrides }
        }
      }
    }
    const agentConfigs = createAgentConfigs(effectiveAgents)

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
    config.default_agent = 'code'

    const userCommands = config.command as Record<string, unknown> | undefined
    const mergedCommands: Record<string, unknown> = { ...PLUGIN_COMMANDS }

    if (userCommands) {
      for (const [name, userCommand] of Object.entries(userCommands)) {
        mergedCommands[name] = userCommand
      }
    }

    config.command = mergedCommands
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
      ...(agent.steps !== undefined ? { steps: agent.steps } : {}),
      ...(agent.hidden ? { hidden: agent.hidden } : {}),
      ...(agent.color ? { color: agent.color } : {}),
      ...(agent.permission ? { permission: agent.permission } : {}),
    }
  }

  return result
}
