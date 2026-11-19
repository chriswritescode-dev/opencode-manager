import { vi } from 'vitest'
import type {
  AgentInfo,
  McpStatus,
  OpenCodeApi,
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageInfo,
  SkillInfo,
} from '@opencode-manager/shared/opencode'
import { createStubOpenCodeApi, createStubOpenCodeClient, sessionInfo, stubLoadedModelCatalog } from './stub-opencode-client'
import type { OpenCodeClient } from '../../src/services/opencode/client'

type SessionActiveState = Awaited<ReturnType<OpenCodeApi['session']['active']>>

interface AssistantMessageTime {
  created: number
  completed?: number
}

export interface ScheduleApiState {
  sessionID: string
  messages: SessionMessageInfo[]
  active: Record<string, { type: 'running' }>
  skills: SkillInfo[]
  agents: string[]
  mcp: Record<string, McpStatus>
  mcpConnectResults: Record<string, McpStatus>
  createError?: Error
  promptError?: Error
  interruptError?: Error
  messageError?: Error
  activeError?: Error
  skillError?: Error
}

export interface ScheduleApiStub {
  api: OpenCodeApi
  state: ScheduleApiState
}

export function createStubScheduleApi(state: Partial<ScheduleApiState> = {}): ScheduleApiStub {
  const resolved: ScheduleApiState = {
    sessionID: 'ses-run-1',
    messages: [],
    active: {},
    skills: [],
    agents: ['build', 'plan'],
    mcp: {},
    mcpConnectResults: {},
    ...state,
  }

  const api = createStubOpenCodeApi()

  api.session.create = vi.fn(async () => {
    if (resolved.createError) throw resolved.createError
    return sessionInfo({ id: resolved.sessionID })
  })
  api.session.prompt = vi.fn(async () => {
    if (resolved.promptError) throw resolved.promptError
    return sessionInboxUser(resolved.sessionID)
  })
  api.session.interrupt = vi.fn(async () => {
    if (resolved.interruptError) throw resolved.interruptError
    return { interrupted: true }
  })
  api.session.active = vi.fn(async () => {
    if (resolved.activeError) throw resolved.activeError
    const active: SessionActiveState = {}
    for (const sessionID of Object.keys(resolved.active)) {
      active[sessionID] = { type: 'running' }
    }
    return active
  })
  api.message.list = vi.fn(async () => {
    if (resolved.messageError) throw resolved.messageError
    return { data: resolved.messages, cursor: {} }
  })
  api.skill.list = vi.fn(async () => {
    if (resolved.skillError) throw resolved.skillError
    return { location: { directory: '' }, data: resolved.skills }
  })
  api.agent.list = vi.fn(async () => ({
    location: { directory: '' },
    data: resolved.agents.map((id) => agentInfo(id)),
  }))
  api.mcp.list = vi.fn(async () => ({
    location: { directory: '' },
    data: Object.entries(resolved.mcp).map(([name, status]) => ({ name, status })),
  }))
  api.mcp.add = vi.fn(async ({ server }: { server: string }) => {
    resolved.mcp[server] = { status: 'pending' }
  })
  api.mcp.connect = vi.fn(async ({ server }: { server: string }) => {
    resolved.mcp[server] = resolved.mcpConnectResults[server] ?? { status: 'connected' }
  })

  return { api, state: resolved }
}

let messageSequence = 0

export function agentInfo(id: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    name: id,
    request: { settings: {}, headers: {}, body: {} },
    mode: 'primary',
    hidden: false,
    permissions: [],
    ...overrides,
  }
}

export function sessionInboxUser(sessionID: string, overrides: Partial<SessionInboxUser> = {}): SessionInboxUser {
  return {
    id: `msg_user_${sessionID}`,
    sessionID,
    type: 'user',
    time: { created: Date.now() },
    payload: { text: '' },
    delivery: 'queue',
    ...overrides,
  }
}

export function assistantMessage(
  text: string,
  options: { completed?: boolean; error?: string; content?: SessionMessageAssistant['content'] } = {},
): SessionMessageInfo {
  messageSequence += 1
  const created = Date.now()

  const time: AssistantMessageTime = { created }
  if (options.completed) {
    time.completed = created
  }
  const message: SessionMessageInfo = {
    id: `msg_assistant_${messageSequence}`,
    type: 'assistant',
    agent: 'build',
    model: { id: 'gpt-5', providerID: 'openai' },
    time,
    content: options.content ?? [{ type: 'text', text }],
  }
  if (options.error) {
    message.error = { type: 'ProviderError', message: options.error }
  }
  return message
}

export function skill(id: string): SkillInfo {
  return { id, name: id, path: `/skills/${id}/SKILL.md`, content: '' }
}

export function createStubScheduleClient(stub: ScheduleApiStub): OpenCodeClient {
  const catalog = stubLoadedModelCatalog()
  return createStubOpenCodeClient({
    api: {
      session: stub.api.session,
      message: stub.api.message,
      skill: stub.api.skill,
      agent: stub.api.agent,
      mcp: stub.api.mcp,
      config: catalog.config,
      model: catalog.model,
    },
  })
}
