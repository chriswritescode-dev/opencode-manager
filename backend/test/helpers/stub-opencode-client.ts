import { vi } from 'vitest'
import { createOpenCodeApi, type ModelInfo, type OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'

export function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'ses_stub',
    projectID: 'proj_stub',
    location: { directory: '' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    ...overrides,
  }
}

export type OpenCodeApiOverrides = {
  [Namespace in keyof OpenCodeApi]?: Partial<OpenCodeApi[Namespace]>
}

export interface StubOpenCodeClientOptions {
  api?: OpenCodeApiOverrides
  forwardRaw?: OpenCodeClient['forwardRaw']
}

function applyNamespace<Namespace extends object>(
  target: Namespace,
  overrides: Partial<Namespace> | undefined,
): void {
  if (overrides !== undefined) {
    Object.assign(target, overrides)
  }
}

export function createStubOpenCodeApi(overrides: OpenCodeApiOverrides = {}): OpenCodeApi {
  const api = createOpenCodeApi({
    baseUrl: 'http://opencode.stub',
    fetch: Object.assign(
      async () => {
        throw new Error('stub OpenCode API received an un-stubbed request')
      },
      { preconnect: fetch.preconnect },
    ),
  })

  applyNamespace(api.server, {
    info: vi.fn(async () => ({ version: '2.0.15', pid: 1234, urls: [], paths: { tmp: '/tmp' } })),
  })
  applyNamespace(api.location, {
    reload: vi.fn(async () => undefined),
    get: vi.fn(async () => ({
      directory: '/tmp/repo',
      project: { id: 'commit-A', directory: '/tmp/repo', canonical: '/tmp/repo' },
    })),
  })
  applyNamespace(api.worktree, {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ directory: '/tmp/wrk-test' })),
    remove: vi.fn(async () => undefined),
  })
  applyNamespace(api.mcp, {
    list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
    add: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  })
  applyNamespace(api.provider, {
    list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
  })
  applyNamespace(api.integration, {
    list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
    get: vi.fn(async () => ({
      location: { directory: '/tmp/repo' },
      data: { id: 'stub-integration', name: 'Stub', methods: [], connections: [] },
    })),
    connect: {
      key: vi.fn(async () => undefined),
      external: vi.fn(async () => undefined),
    },
    oauth: {
      connect: vi.fn(async () => ({
        location: { directory: '/tmp/repo' },
        data: {
          attemptID: 'con_stub',
          url: 'https://example.com/authorize',
          instructions: 'Authorize in your browser',
          mode: 'auto' as const,
          time: { created: 0, expires: 0 },
        },
      })),
      status: vi.fn(async () => ({
        location: { directory: '/tmp/repo' },
        data: { status: 'pending' as const, time: { created: 0, expires: 0 } },
      })),
      complete: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    },
  })
  applyNamespace(api.credential, {
    remove: vi.fn(async () => undefined),
  })
  applyNamespace(api.skill, {
    list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: [] })),
  })

  applyNamespace(api.server, overrides.server)
  applyNamespace(api.location, overrides.location)
  applyNamespace(api.worktree, overrides.worktree)
  applyNamespace(api.mcp, overrides.mcp)
  applyNamespace(api.provider, overrides.provider)
  applyNamespace(api.integration, overrides.integration)
  applyNamespace(api.credential, overrides.credential)
  applyNamespace(api.skill, overrides.skill)
  applyNamespace(api.pty, overrides.pty)
  applyNamespace(api.generate, overrides.generate)
  applyNamespace(api.session, overrides.session)
  applyNamespace(api.message, overrides.message)
  applyNamespace(api.config, overrides.config)
  applyNamespace(api.model, overrides.model)
  applyNamespace(api.agent, overrides.agent)
  applyNamespace(api.permission, overrides.permission)
  applyNamespace(api.event, overrides.event)
  applyNamespace(api.form, overrides.form)
  applyNamespace(api.generate, overrides.generate)

  return api
}

export function createStubOpenCodeClient(options: StubOpenCodeClientOptions = {}): OpenCodeClient {
  return {
    api: createStubOpenCodeApi(options.api),
    forwardRaw: options.forwardRaw ?? vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
  }
}

export function modelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'gpt-5-mini',
    modelID: 'gpt-5-mini',
    providerID: 'openai',
    name: 'GPT-5 mini',
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: 'active',
    enabled: true,
    limit: { context: 128000, output: 8192 },
    ...overrides,
  }
}

export function stubLoadedModelCatalog(models: ModelInfo[] = [modelInfo()]) {
  const defaultModel = models[0] ?? null
  return {
    config: { get: vi.fn(async () => []) },
    model: {
      list: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: models })),
      default: vi.fn(async () => ({ location: { directory: '/tmp/repo' }, data: defaultModel })),
    },
  }
}
