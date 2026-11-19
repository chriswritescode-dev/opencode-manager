import { useReducer } from 'react'
import { act, screen } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import type { ReactNode } from 'react'
import type { CreateScheduleJobRequest, PromptTemplate, ScheduleJob } from '@opencode-manager/shared/types'
import type { AgentInfo, McpServer, ModelInfo, ModelRef } from '@opencode-manager/shared/opencode'
import type { UserPreferences } from '@/api/types/settings'
import type { ScheduleServerTarget } from '@/api/schedules'
import type { Repo } from '@/api/types'
import { ScheduleJobDialog } from '@/components/schedules/ScheduleJobDialog'
import { renderWithProviders } from './render'
import {
  makeAssistantModeStatus,
  makeCatalogModel,
  makeHealthResponse,
  makeRepo,
  makeScheduleJob,
  makeSettingsResponse,
  makeUserPreferences,
} from './fixtures/api'
import type { FetchRoute } from './fetchFake'

export interface CatalogProviderFixture {
  id: string
  name: string
  activation?: 'auto' | 'enabled' | 'disabled'
}

export interface ScheduleJobDialogFixture {
  job?: ScheduleJob
  showRepoSelector?: boolean
  repoId?: number
  serverTarget?: ScheduleServerTarget
  preferences?: Partial<UserPreferences>
  sandbox?: { available: boolean; reason?: string }
  templates?: PromptTemplate[]
  templatesPending?: boolean
  agents?: Record<string, AgentInfo[]>
  repos?: Repo[]
  models?: ModelInfo[]
  providers?: CatalogProviderFixture[]
  defaultModel?: ModelRef | null
  mcpServers?: McpServer[]
}

export interface ScheduleJobDialogHandlers {
  onSubmit: Mock<(data: CreateScheduleJobRequest) => void>
  onOpenChange: Mock<(open: boolean) => void>
  onRepoChange: Mock<(repoId: number | undefined) => void>
}

export function makeConfigProvider(overrides: Partial<CatalogProviderFixture> & { id: string }): CatalogProviderFixture {
  return { name: overrides.id, activation: 'enabled', ...overrides }
}

export function makeCatalogModels(entries: Array<{ providerID: string; id: string; name?: string }>): ModelInfo[] {
  return entries.map((entry) =>
    makeCatalogModel({
      providerID: entry.providerID,
      id: entry.id,
      modelID: entry.id,
      name: entry.name ?? entry.id,
    }),
  )
}

export function makeMcpServer(name: string, status: 'connected' | 'disabled' | 'pending' | 'failed'): McpServer {
  if (status === 'connected') return { name, status: { status: 'connected' } }
  if (status === 'disabled') return { name, status: { status: 'disabled' } }
  if (status === 'pending') return { name, status: { status: 'pending' } }
  return { name, status: { status: 'failed', error: 'connection failed' } }
}

const DEFAULT_MODELS: ModelInfo[] = makeCatalogModels([
  { providerID: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
])

function openCodeRoutes(fixture: ScheduleJobDialogFixture, base: string): FetchRoute[] {
  return [
    { method: 'GET', path: `${base}/mcp`, respond: () => ({ json: { data: fixture.mcpServers ?? [] } }) },
    {
      method: 'GET',
      path: `${base}/agent`,
      respond: (request) => ({ json: { data: fixture.agents?.[request.searchParams.get('location[directory]') ?? ''] ?? [] } }),
    },
    {
      method: 'GET',
      path: `${base}/provider`,
      respond: () => ({ json: { data: fixture.providers ?? [makeConfigProvider({ id: 'anthropic', name: 'Anthropic' })] } }),
    },
    { method: 'GET', path: `${base}/model`, respond: () => ({ json: { data: fixture.models ?? DEFAULT_MODELS } }) },
    { method: 'GET', path: `${base}/config`, respond: () => ({ json: {} }) },
    { method: 'GET', path: `${base}/model/default`, respond: () => ({ json: { data: fixture.defaultModel ?? null } }) },
  ]
}

function buildFetchRoutes(fixture: ScheduleJobDialogFixture): FetchRoute[] {
  const preferences = makeUserPreferences(fixture.preferences)
  const sandbox = fixture.sandbox ?? { available: true }
  const serverId = fixture.serverTarget?.serverId

  return [
    { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences }) }) },
    {
      method: 'GET',
      path: '/api/health',
      respond: () => ({
        json: makeHealthResponse({
          sandbox: { available: sandbox.available, enabled: sandbox.available, enforced: false, reason: sandbox.reason },
        }),
      }),
    },
    {
      method: 'GET',
      path: '/api/prompt-templates',
      respond: () => (fixture.templatesPending ? new Promise(() => {}) : { json: { templates: fixture.templates ?? [] } }),
    },
    { method: 'DELETE', path: '/api/prompt-templates/:id', respond: () => ({ status: 204 }) },
    { method: 'GET', path: '/api/settings/skills', respond: () => ({ json: [] }) },
    ...openCodeRoutes(fixture, '/api/opencode/api'),
    ...(serverId ? openCodeRoutes(fixture, `/api/opencode/servers/${serverId}/api`) : []),
    { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: {} }) },
    { method: 'GET', path: '/api/repos', respond: () => ({ json: fixture.repos ?? [] }) },
    {
      method: 'GET',
      path: '/api/repos/:id/assistant-mode',
      respond: () => ({ json: makeAssistantModeStatus({ directory: '/workspace/repos/assistant' }) }),
    },
    {
      method: 'GET',
      path: '/api/repos/:id',
      respond: (_request, params) => {
        const id = Number(params.id)
        return { json: fixture.repos?.find((repo) => repo.id === id) ?? makeRepo({ id, fullPath: `/workspace/repos/${id}` }) }
      },
    },
  ]
}

export async function renderScheduleJobDialog(fixture: ScheduleJobDialogFixture = {}) {
  const active: ScheduleJobDialogFixture = fixture
  const harness = { rerender: () => {} }
  const handlers: ScheduleJobDialogHandlers = {
    onSubmit: vi.fn<(data: CreateScheduleJobRequest) => void>(),
    onOpenChange: vi.fn<(open: boolean) => void>(),
    onRepoChange: vi.fn<(repoId: number | undefined) => void>(),
  }

  function Harness(): ReactNode {
    const [, force] = useReducer((count: number) => count + 1, 0)
    harness.rerender = force
    return (
      <ScheduleJobDialog
        open
        onOpenChange={handlers.onOpenChange}
        job={active.job}
        isSaving={false}
        onSubmit={handlers.onSubmit}
        showRepoSelector={active.showRepoSelector}
        repoId={active.repoId}
        onRepoChange={handlers.onRepoChange}
        serverTarget={active.serverTarget}
      />
    )
  }

  const result = renderWithProviders(<Harness />, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: buildFetchRoutes(fixture),
  })

  return {
    ...result,
    ...handlers,
    rerenderWith: async (update: Partial<ScheduleJobDialogFixture> = {}) => {
      Object.assign(active, update)
      await act(async () => {
        harness.rerender()
      })
    },
  }
}

export function makeScheduleJobFixture(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return makeScheduleJob(overrides)
}

export function bashDenyPatternsTextarea(): HTMLTextAreaElement {
  const field = screen.getByLabelText('Blocked bash commands')
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('Blocked bash commands is not a textarea')
  return field
}
