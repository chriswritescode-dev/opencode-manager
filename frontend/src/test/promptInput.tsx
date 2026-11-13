import { useReducer } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { ReactNode } from 'react'
import type { AgentInfo, CommandInfo, ModelRef, SessionGoalRead, SessionInboxInfo, SessionMessageInfo, SkillInfo } from '@opencode-manager/shared/opencode'
import { DEFAULT_STT_CONFIG, type SessionPermissionModeState, type SessionSandboxState } from '@opencode-manager/shared/schemas'
import type { UserPreferences } from '@/api/types/settings'
import { PromptInput, type PromptInputHandle } from '@/components/message/PromptInput'
import type { VoiceConversationFactory } from '@/components/message/VoiceConversation'
import type { PageCommandActions } from '@/lib/builtinCommands'
import { SessionTranscriptContext } from '@/contexts/session-transcript-context'
import { createTestQueryClient, renderWithProviders } from './render'
import { makeSession, makeSettingsResponse, makeUserPreferences } from './fixtures/api'
import { installSpeechRecognition, installWindowSize } from './browserFakes'
import { createCommandActionsMock } from './test-utils'
import { emptySessionTranscript } from '@/lib/session-projection'
import type { FetchRoute, FetchRouteResult } from './fetchFake'
import type { Ref } from 'react'

export interface PromptInputFixture {
  sessionID?: string
  directory?: string
  isSessionActive?: boolean
  isStreamingResponse?: boolean
  mobile?: boolean
  stt?: 'enabled' | 'disabled' | 'unsupported'
  settings?: Partial<UserPreferences>
  agents?: AgentInfo[]
  skills?: SkillInfo[]
  commands?: CommandInfo[]
  goal?: SessionGoalRead
  permissionMode?: SessionPermissionModeState | null
  sandbox?: SessionSandboxState
  models?: RawModelFixture[]
  deferProviders?: boolean
  files?: string[]
  modelState?: RawModelStateFixture
  defaultModel?: ModelRef | null
  sessionAgent?: string
  sessionModel?: ModelRef
  sessionRevert?: { messageID: string }
  transcript?: { messages?: SessionMessageInfo[], pending?: SessionInboxInfo[], status?: 'idle' | 'busy' | 'retry' }
  promptRef?: Ref<PromptInputHandle>
  commandActions?: PageCommandActions
  voiceConversation?: VoiceConversationFactory
  sendPrompt?: () => FetchRouteResult | Promise<FetchRouteResult>
  sendShell?: () => FetchRouteResult | Promise<FetchRouteResult>
  runCommand?: () => FetchRouteResult | Promise<FetchRouteResult>
  onPromptChange?: (hasContent: boolean) => void
  onSuggestionsOpenChange?: (open: boolean) => void
  onVoiceConversationActiveChange?: (active: boolean) => void
}

export function makeAgent(overrides: Partial<AgentInfo> & { id: string }): AgentInfo {
  return {
    name: overrides.id,
    mode: 'subagent',
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
    ...overrides,
  }
}

export interface RawModelFixture {
  id: string
  providerID: string
  name: string
  contextLimit?: number
  outputLimit?: number
  variants?: string[]
}

export interface RawModelStateFixture {
  recent?: Array<{ providerID: string, modelID: string }>
  favorite?: Array<{ providerID: string, modelID: string }>
  variant?: Record<string, string | null>
}

const DEFAULT_MODEL: RawModelFixture = {
  id: 'claude-sonnet-4-5',
  providerID: 'anthropic',
  name: 'Claude Sonnet 4.5',
  contextLimit: 200000,
  outputLimit: 64000,
}

function rawModel(fixture: RawModelFixture) {
  return {
    id: fixture.id,
    modelID: fixture.id,
    providerID: fixture.providerID,
    name: fixture.name,
    capabilities: {},
    enabled: true,
    status: 'active',
    limit: { context: fixture.contextLimit ?? 200000, output: fixture.outputLimit ?? 64000 },
    time: { released: 1 },
    cost: [{ input: 3, output: 15 }],
    variants: (fixture.variants ?? []).map((id) => ({ id, name: id })),
  }
}

const emptySandbox: SessionSandboxState = {
  sessionId: 'test-session',
  rootSessionId: 'test-session',
  sandboxed: false,
  source: 'default',
  resources: null,
  effectiveResources: { cpus: 2, memoryMib: 4096 },
  lockedReason: null,
  available: true,
}

export async function renderPromptInput(fixture: PromptInputFixture = {}) {
  const active: PromptInputFixture = fixture
  const sessionID = active.sessionID ?? 'test-session'
  installWindowSize(active.mobile ? 500 : 1024)
  const sttMode = active.stt ?? 'enabled'
  if (sttMode !== 'unsupported') installSpeechRecognition()

  const harness = { rerender: () => {} }

  function Harness(): ReactNode {
    const [, force] = useReducer((count: number) => count + 1, 0)
    harness.rerender = force
    const transcript = {
      ...emptySessionTranscript,
      messages: active.transcript?.messages ?? [],
      pending: active.transcript?.pending ?? [],
    }
    return (
      <SessionTranscriptContext.Provider
        value={{
          messages: transcript.messages,
          pending: transcript.pending,
          status: active.transcript?.status ?? (active.isSessionActive ? 'busy' : 'idle'),
        }}
      >
        <PromptInput
          key={active.sessionID ?? 'test-session'}
          sessionID={active.sessionID ?? 'test-session'}
          directory={active.directory ?? '/test'}
          isSessionActive={active.isSessionActive ?? false}
          isStreamingResponse={active.isStreamingResponse ?? false}
          onScrollToBottom={() => {}}
          commandActions={active.commandActions ?? createCommandActionsMock()}
          onPromptChange={active.onPromptChange}
          onSuggestionsOpenChange={active.onSuggestionsOpenChange}
          onVoiceConversationActiveChange={active.onVoiceConversationActiveChange}
          voiceConversation={active.voiceConversation}
          ref={active.promptRef}
        />
      </SessionTranscriptContext.Provider>
    )
  }

  const settingsOverrides: Partial<UserPreferences> = { ...active.settings }
  if (!settingsOverrides.stt) {
    settingsOverrides.stt = { ...DEFAULT_STT_CONFIG, enabled: sttMode === 'enabled' }
  }
  const preferences = makeUserPreferences(settingsOverrides)
  const settings = makeSettingsResponse({ preferences })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['settings', 'default'], settings)
  queryClient.setQueryData(['opencode', 'transcript', sessionID], {
    transcript: {
      ...emptySessionTranscript,
      messages: active.transcript?.messages ?? [],
      pending: active.transcript?.pending ?? [],
    },
  })

  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/settings', respond: () => ({ json: settings }) },
    { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
    { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: [] }) },
    { method: 'GET', path: '/api/opencode/api/session/active', respond: () => ({ json: { data: {} } }) },
    { method: 'GET', path: '/api/opencode/api/permission/request', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/form', respond: () => ({ json: { data: [] } }) },
    { method: 'GET', path: '/api/opencode/api/shell', respond: () => ({ json: { data: [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/session/:sessionId',
      respond: () => {
        const session = makeSession({ id: sessionID, title: 'Test session' })
        if (active.sessionAgent) session.agent = active.sessionAgent
        if (active.sessionModel) session.model = active.sessionModel
        if (active.sessionRevert) session.revert = active.sessionRevert
        return { json: { data: session } }
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/prompt',
      respond: () => active.sendPrompt?.() ?? {
        json: { data: { id: 'inbox_1', sessionID, type: 'user', time: { created: 1 }, payload: { text: '' }, delivery: 'queue' } },
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/shell',
      respond: () => active.sendShell?.() ?? { status: 204 },
    },
    { method: 'POST', path: '/api/opencode/api/session/:sessionId/interrupt', respond: () => ({ json: {} }) },
    { method: 'POST', path: '/api/opencode/api/session/:sessionId/agent', respond: () => ({ status: 204 }) },
    { method: 'POST', path: '/api/opencode/api/session/:sessionId/model', respond: () => ({ status: 204 }) },
    {
      method: 'POST',
      path: '/api/opencode/api/session/:sessionId/command',
      respond: () => active.runCommand?.() ?? { status: 204 },
    },
    {
      method: 'POST',
      path: '/api/opencode/api/rpc/:rpcId/:method',
      respond: () => {
        if (active.goal?.supported === false) return { json: { output: { unsupported: true } } }
        return { json: { output: active.goal?.goal ?? null } }
      },
    },
    { method: 'GET', path: '/api/opencode/api/agent', respond: () => ({ json: { data: active.agents ?? [] } }) },
    { method: 'GET', path: '/api/opencode/api/skill', respond: () => ({ json: { data: active.skills ?? [] } }) },
    { method: 'GET', path: '/api/opencode/api/command', respond: () => ({ json: { data: active.commands ?? [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/fs/find',
      respond: () => ({ json: { data: (active.files ?? []).map((path) => ({ path, type: 'file' })) } }),
    },
    { method: 'GET', path: '/api/opencode/api/experimental/session/:sessionId/instructions/entries', respond: () => ({ json: { data: [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/api/provider',
      respond: () => {
        if (active.deferProviders) return new Promise(() => {})
        return { json: { data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }] } }
      },
    },
    {
      method: 'GET',
      path: '/api/opencode/api/model',
      respond: () => ({ json: { data: (active.models ?? [DEFAULT_MODEL]).map(rawModel) } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/model/default',
      respond: () => {
        const configured = active.defaultModel ?? { providerID: 'anthropic', id: 'claude-sonnet-4-5' }
        return { json: { data: configured } }
      },
    },
    { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
    {
      method: 'GET',
      path: '/api/providers/model-state',
      respond: () => ({ json: active.modelState ?? {} }),
    },
    { method: 'POST', path: '/api/providers/model-state', respond: () => ({ json: active.modelState ?? {} }) },
    {
      method: 'GET',
      path: `/api/session-permission-modes/${sessionID}`,
      respond: () => ({
        json: active.permissionMode ?? {
          sessionId: sessionID,
          rootSessionId: sessionID,
          mode: 'ask',
          lockedReason: null,
        },
      }),
    },
    {
      method: 'PUT',
      path: `/api/session-permission-modes/${sessionID}`,
      respond: () => ({
        json: active.permissionMode ?? {
          sessionId: sessionID,
          rootSessionId: sessionID,
          mode: 'ask',
          lockedReason: null,
        },
      }),
    },
    {
      method: 'GET',
      path: `/api/session-sandbox/${sessionID}`,
      respond: () => ({ json: active.sandbox ?? { ...emptySandbox, sessionId: sessionID, rootSessionId: sessionID } }),
    },
    {
      method: 'PUT',
      path: `/api/session-sandbox/${sessionID}`,
      respond: () => ({ json: active.sandbox ?? { ...emptySandbox, sessionId: sessionID, rootSessionId: sessionID } }),
    },
  ]

  const result = renderWithProviders(<Harness />, {
    events: true,
    tts: true,
    queryClient,
    fetchRoutes: routes,
  })

  const hasModels = (active.models ?? [DEFAULT_MODEL]).length > 0
  if (active.deferProviders) {
    await waitFor(() => expect(result.fetchFake.lastRequest('GET', '/api/opencode/api/provider')).toBeDefined())
  } else if (hasModels) {
    await screen.findByRole('button', { name: /context|Claude Sonnet 4\.5/ })
  } else {
    await waitFor(() => {
      expect(result.fetchFake.lastRequest('GET', '/api/opencode/api/model')).toBeDefined()
      expect(result.fetchFake.lastRequest('GET', '/api/opencode/api/config')).toBeDefined()
    })
  }

  return {
    ...result,
    rerenderWith: async (update: PromptInputFixture = {}) => {
      Object.assign(active, update)
      await act(async () => {
        harness.rerender()
      })
    },
  }
}

export function promptTextarea(): HTMLTextAreaElement {
  const input = document.querySelector('[data-prompt-input]')
  if (!(input instanceof HTMLTextAreaElement)) throw new Error('prompt textarea is not rendered')
  return input
}
