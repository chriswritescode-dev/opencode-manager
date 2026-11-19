import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
type CatalogList<Name extends 'model' | 'provider'> = NonNullable<ReturnType<Context['data']['location'][Name]['list']>>
type ModelInfo = CatalogList<'model'>[number]
type ProviderInfo = CatalogList<'provider'>[number]
import type { MultiRun, MultiRunEntry, MultiRunFusion } from '@opencode-manager/shared/schemas'
import { JsonObjectSchema, parseJsonText, type JsonObject } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import {
  describeMultiRunError,
  filterModelOptions,
  formatEntryStatus,
  listModelOptions,
  openManagerSessions,
  parseFusionForm,
  parseLaunchForm,
  runMultiRunCommand,
  runSummary,
  toggleFusionSource,
  MULTI_RUN_ATTACH_REQUIRED,
  MULTI_RUN_ROUTE_MISSING,
} from '../src/tui-multi-run.js'
import type {
  LaunchFormInput,
  MultiRunActions,
  MultiRunLaunchDialogProps,
  MultiRunsDialogProps,
} from '../src/tui-multi-run.js'
import { ManagerApiError } from '../src/manager-api.js'
import type { ManagerAuthDeps } from '../src/manager-auth.js'
import type { OcmTuiContext } from '../src/tui-context.js'
import type { RemoteContext } from '../src/remote-context.js'

const remote: RemoteContext = {
  managerUrl: 'https://manager.example',
  managerHost: 'manager.example',
  repoName: 'repo',
  repoId: 1,
}

const STORE_LABEL = 'file: /tmp/credentials.json'

interface FakeProvider {
  id: string
  name: string
  activation: 'auto' | 'enabled' | 'disabled'
}

function provider(overrides: Partial<ProviderInfo> = {}) {
  const fake: FakeProvider = { id: 'openai', name: 'OpenAI', activation: 'enabled' }
  const resolved: ProviderInfo = { package: '@ai-sdk/openai', ...fake, ...overrides }
  return resolved
}

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  const base: ModelInfo = {
    id: 'gpt-5',
    modelID: 'gpt-5',
    providerID: 'openai',
    name: 'GPT-5',
    capabilities: { tools: false, input: [], output: [] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: 'active',
    enabled: true,
    limit: { context: 0, output: 0 },
  }
  return { ...base, ...overrides }
}

function entry(overrides: Partial<MultiRunEntry> = {}): MultiRunEntry {
  return {
    id: 1,
    model: 'openai/gpt-5',
    status: 'started',
    sessionId: 'ses_1',
    directory: '/work/1',
    isolated: true,
    error: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function multiRun(overrides: Partial<MultiRun> = {}): MultiRun {
  return {
    id: 3,
    repoId: 1,
    serverId: 'local',
    directory: null,
    name: 'sweep',
    prompt: 'hello',
    isolated: true,
    baseRef: null,
    createdAt: 1,
    entries: [entry()],
    fusions: [],
    ...overrides,
  }
}

function fusion(overrides: Partial<MultiRunFusion> = {}): MultiRunFusion {
  return {
    id: 9,
    requestId: 'req-1',
    model: 'anthropic/claude',
    instructions: null,
    isolated: true,
    baseRef: null,
    status: 'started',
    sessionId: 'ses_f',
    directory: '/work/f',
    error: null,
    sources: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

interface RecordedRequest {
  method: string
  url: string
  authorization: string | null
  body: JsonObject | null
}

type RouteHandler = (request: RecordedRequest) => Response

interface MultiRunRoutes {
  list?: RouteHandler
  launch?: RouteHandler
  fuse?: RouteHandler
  discard?: RouteHandler
}

function requestBody(init: RequestInit | undefined): JsonObject | null {
  const text = z.string().safeParse(init?.body)
  return text.success ? JsonObjectSchema.parse(parseJsonText(text.data)) : null
}

function fusionRequestId(request: RecordedRequest): string {
  return z.string().parse(request.body?.requestId)
}

function fuseResponding(overrides: Partial<MultiRunFusion> = {}): RouteHandler {
  return (request) => Response.json({ run: multiRun({ fusions: [fusion({ requestId: fusionRequestId(request), ...overrides })] }) })
}

function createManager(routes: MultiRunRoutes = {}) {
  const requests: RecordedRequest[] = []
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = new URL(String(input))
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      authorization: new Headers(init?.headers).get('authorization'),
      body: requestBody(init),
    }
    requests.push(request)
    if (url.pathname.endsWith('/fusions')) return (routes.fuse ?? fuseResponding())(request)
    if (url.pathname.endsWith('/discard')) return (routes.discard ?? (() => Response.json({ run: multiRun() })))(request)
    if (url.pathname === '/api/internal/multi-runs') {
      if (request.method === 'POST') return (routes.launch ?? (() => Response.json({ run: multiRun() })))(request)
      return (routes.list ?? (() => Response.json({ runs: [] })))(request)
    }
    return new Response(`unexpected route ${request.url}`, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    requests,
    fetchMock,
    requestsTo: (pathSuffix: string) => requests.filter((request) => request.url.includes(pathSuffix)),
  }
}

function createFakeContext() {
  const toast = vi.fn<Context['ui']['toast']['show']>()
  const prompt = vi.fn<Context['ui']['dialog']['prompt']>()
  const select = vi.fn()
  const confirm = vi.fn<Context['ui']['dialog']['confirm']>()
  const open = vi.fn<Context['ui']['tabs']['open']>(() => true)
  const focus = vi.fn<Context['ui']['tabs']['focus']>(() => true)
  const enabled = vi.fn<Context['ui']['tabs']['enabled']>(() => true)
  const navigate = vi.fn<Context['ui']['router']['navigate']>()
  const current = vi.fn<Context['ui']['router']['current']>(() => ({ type: 'session', sessionID: 'ses_a' }))
  const sync = vi.fn<() => Promise<void>>(async () => undefined)
  const list = vi.fn<() => ModelInfo[] | undefined>(() => [])
  const providerSync = vi.fn<() => Promise<void>>(async () => undefined)
  const providerList = vi.fn<() => ProviderInfo[] | undefined>(() => [])
  const context: OcmTuiContext = {
    ui: {
      toast: { show: toast },
      dialog: { prompt, select, confirm },
      tabs: { enabled, open, focus },
      router: { navigate, current },
      slot: vi.fn(),
    },
    data: {
      session: { get: () => undefined },
      location: {
        model: { sync, list },
        provider: { sync: providerSync, list: providerList },
      },
    },
    keymap: { layer: vi.fn(), dispatch: vi.fn() },
    client: { session: { export: vi.fn() } },
  }
  return { context, toast, prompt, select, confirm, open, focus, enabled, navigate, sync, list, providerSync, providerList }
}

function authDeps(getToken: () => Promise<string | null> = async () => 'tok'): ManagerAuthDeps {
  return {
    readState: () => ({ managerUrl: remote.managerUrl }),
    getToken,
    describeTokenStore: () => ({ kind: 'file', location: '/tmp/credentials.json' }),
  }
}

function depsFor() {
  return {
    remote,
    showLaunchDialog: vi.fn<(props: MultiRunLaunchDialogProps) => void>(),
    showRunsDialog: vi.fn<(props: MultiRunsDialogProps) => void>(),
    auth: authDeps(),
  }
}

async function launchActions(fake: ReturnType<typeof createFakeContext>, manager = createManager()): Promise<MultiRunActions> {
  const deps = depsFor()
  await runMultiRunCommand(fake.context, deps, '/ocm-multirun hello')
  expect(manager.requests.length).toBeGreaterThan(0)
  return deps.showLaunchDialog.mock.calls[0]![0].actions
}

const UUID = '7f1c9d2e-3b4a-4c5d-8e6f-0a1b2c3d4e5f'

function launchForm(overrides: Partial<LaunchFormInput> = {}): LaunchFormInput {
  return { prompt: 'fix the flaky test', name: '', models: ['openai/gpt-5'], isolate: true, baseRef: '', ...overrides }
}

function fusionForm(overrides: Partial<{ entryIds: number[]; model: string; baseRef: string; instructions: string }> = {}) {
  return { entryIds: [1, 2], model: 'anthropic/claude', baseRef: '', instructions: '', ...overrides }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listModelOptions', () => {
  it('syncs then maps selectable models of active providers to refs', async () => {
    const fake = createFakeContext()
    fake.providerList.mockReturnValue([provider({ id: 'openai', name: 'OpenAI' }), provider({ id: 'anthropic', name: 'Anthropic' })])
    fake.list.mockReturnValue([
      model({ providerID: 'openai', id: 'gpt-5', name: 'GPT-5' }),
      model({ providerID: 'anthropic', id: 'claude', name: 'Claude' }),
      model({ providerID: 'openai', id: 'old', name: 'Old', status: 'deprecated' }),
      model({ providerID: 'openai', id: 'off', name: 'Off', enabled: false }),
    ])

    await expect(listModelOptions(fake.context)).resolves.toEqual([
      { title: 'Claude', description: 'anthropic/claude', value: 'anthropic/claude' },
      { title: 'GPT-5', description: 'openai/gpt-5', value: 'openai/gpt-5' },
    ])
    expect(fake.sync).toHaveBeenCalledTimes(1)
    expect(fake.providerSync).toHaveBeenCalledTimes(1)
    expect(fake.sync.mock.invocationCallOrder[0]).toBeLessThan(fake.list.mock.invocationCallOrder[0])
  })

  it('drops models whose provider is disabled or absent from the catalog', async () => {
    const fake = createFakeContext()
    fake.providerList.mockReturnValue([provider({ id: 'openai', name: 'OpenAI' }), provider({ id: 'hidden', name: 'Hidden', activation: 'disabled' })])
    fake.list.mockReturnValue([
      model({ providerID: 'openai', id: 'gpt-5', name: 'GPT-5' }),
      model({ providerID: 'hidden', id: 'h', name: 'Hidden' }),
      model({ providerID: 'ghost', id: 'g', name: 'Ghost' }),
    ])

    await expect(listModelOptions(fake.context)).resolves.toEqual([
      { title: 'GPT-5', description: 'openai/gpt-5', value: 'openai/gpt-5' },
    ])
  })

  it('orders by provider rank then provider name', async () => {
    const fake = createFakeContext()
    fake.providerList.mockReturnValue([
      provider({ id: 'zeta', name: 'Zeta' }),
      provider({ id: 'opencode-go', name: 'OpenCode Go' }),
      provider({ id: 'alpha', name: 'Alpha' }),
    ])
    fake.list.mockReturnValue([
      model({ providerID: 'zeta', id: 'z', name: 'Z' }),
      model({ providerID: 'alpha', id: 'a', name: 'A' }),
      model({ providerID: 'opencode-go', id: 'o', name: 'O' }),
    ])

    await expect(listModelOptions(fake.context)).resolves.toEqual([
      { title: 'O', description: 'opencode-go/o', value: 'opencode-go/o' },
      { title: 'A', description: 'alpha/a', value: 'alpha/a' },
      { title: 'Z', description: 'zeta/z', value: 'zeta/z' },
    ])
  })

  it('prefers free then newest models within a provider', async () => {
    const fake = createFakeContext()
    fake.providerList.mockReturnValue([provider({ id: 'openai', name: 'OpenAI' })])
    fake.list.mockReturnValue([
      model({ providerID: 'openai', id: 'paid', name: 'Paid', cost: [{ input: 3, output: 0, cache: { read: 0, write: 0 } }], time: { released: 9 } }),
      model({ providerID: 'openai', id: 'free-old', name: 'Free Old', cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], time: { released: 1 } }),
      model({ providerID: 'openai', id: 'free-new', name: 'Free New', cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], time: { released: 5 } }),
      model({ providerID: 'openai', id: 'paid-new', name: 'Paid New', cost: [{ input: 3, output: 0, cache: { read: 0, write: 0 } }], time: { released: 10 } }),
    ])

    await expect(listModelOptions(fake.context)).resolves.toEqual([
      { title: 'Free New', description: 'openai/free-new', value: 'openai/free-new' },
      { title: 'Free Old', description: 'openai/free-old', value: 'openai/free-old' },
      { title: 'Paid New', description: 'openai/paid-new', value: 'openai/paid-new' },
      { title: 'Paid', description: 'openai/paid', value: 'openai/paid' },
    ])
  })

  it.each([
    { label: 'model', models: undefined, providers: [provider()] },
    { label: 'provider', models: [model()], providers: undefined },
  ])('tolerates a $label list that is not loaded yet', async ({ models, providers }) => {
    const fake = createFakeContext()
    fake.list.mockReturnValue(models)
    fake.providerList.mockReturnValue(providers)

    await expect(listModelOptions(fake.context)).resolves.toEqual([])
  })
})

describe('openManagerSessions', () => {
  it('opens a tab per session then focuses the first when tabs are enabled', () => {
    const fake = createFakeContext()

    openManagerSessions(fake.context, ['ses_1', 'ses_2'])

    expect(fake.open).toHaveBeenNthCalledWith(1, 'ses_1')
    expect(fake.open).toHaveBeenNthCalledWith(2, 'ses_2')
    expect(fake.focus).toHaveBeenCalledWith('ses_1')
    expect(fake.navigate).not.toHaveBeenCalled()
  })

  it('navigates to the first session when tabs are disabled', () => {
    const fake = createFakeContext()
    fake.enabled.mockReturnValue(false)

    openManagerSessions(fake.context, ['ses_1', 'ses_2'])

    expect(fake.navigate).toHaveBeenCalledWith({ type: 'session', sessionID: 'ses_1' })
    expect(fake.open).not.toHaveBeenCalled()
    expect(fake.focus).not.toHaveBeenCalled()
  })

  it('does nothing for an empty session list', () => {
    const fake = createFakeContext()

    openManagerSessions(fake.context, [])

    expect(fake.enabled).not.toHaveBeenCalled()
    expect(fake.open).not.toHaveBeenCalled()
    expect(fake.focus).not.toHaveBeenCalled()
    expect(fake.navigate).not.toHaveBeenCalled()
  })
})

describe('formatEntryStatus', () => {
  it('describes the status, isolation and error', () => {
    expect(formatEntryStatus(entry({ status: 'started', isolated: true }))).toBe('Started · isolated')
    expect(formatEntryStatus(entry({ status: 'failed', isolated: false, error: 'model unavailable' }))).toBe(
      'Failed · shared directory · model unavailable',
    )
    expect(formatEntryStatus(entry({ status: 'discarded', isolated: true }))).toBe('Discarded · isolated')
  })
})

describe('filterModelOptions', () => {
  const options = [
    { title: 'GPT-5', description: 'openai/gpt-5', value: 'openai/gpt-5' },
    { title: 'Claude Sonnet', description: 'anthropic/claude-sonnet', value: 'anthropic/claude-sonnet' },
  ]

  it('returns every option for a blank query', () => {
    expect(filterModelOptions(options, '  ')).toEqual(options)
  })

  it('matches every term against the name or ref, case-insensitively', () => {
    expect(filterModelOptions(options, 'ANTHROPIC son')).toEqual([options[1]])
    expect(filterModelOptions(options, 'gpt claude')).toEqual([])
  })
})

describe('runSummary', () => {
  it('counts models, started entries and fusions', () => {
    expect(runSummary(multiRun({ entries: [entry(), entry({ id: 2, status: 'failed' })], fusions: [fusion()] }))).toBe(
      '2 models · 1 started · 1 fusions',
    )
  })
})

describe('parseLaunchForm', () => {
  it('builds the launch request and defaults the name to the first prompt line', () => {
    expect(parseLaunchForm(launchForm({ prompt: '  fix the flaky test\nmore detail', baseRef: ' main ' }), 1)).toEqual({
      ok: true,
      value: {
        repoId: 1,
        name: 'fix the flaky test',
        prompt: 'fix the flaky test\nmore detail',
        models: ['openai/gpt-5'],
        isolate: true,
        baseRef: 'main',
      },
    })
  })

  it('keeps an explicit name and drops the base ref for a shared directory', () => {
    const result = parseLaunchForm(launchForm({ name: ' Sweep ', isolate: false, baseRef: 'main' }), 1)
    expect(result).toEqual({
      ok: true,
      value: { repoId: 1, name: 'Sweep', prompt: 'fix the flaky test', models: ['openai/gpt-5'], isolate: false },
    })
  })

  it('rejects a missing prompt or model and too many models', () => {
    expect(parseLaunchForm(launchForm({ prompt: ' ' }), 1)).toEqual({ ok: false, error: 'Enter a prompt to send to every model.' })
    expect(parseLaunchForm(launchForm({ models: [] }), 1)).toEqual({ ok: false, error: 'Choose at least one model.' })
    expect(parseLaunchForm(launchForm({ models: ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6'] }), 1)).toEqual({
      ok: false,
      error: 'Choose at most 5 models.',
    })
  })
})

describe('toggleFusionSource', () => {
  const run = multiRun({
    entries: [
      entry({ id: 1 }),
      entry({ id: 2, sessionId: 'ses_2' }),
      entry({ id: 3, status: 'failed', sessionId: null }),
      entry({ id: 4, sessionId: 'ses_4' }),
      entry({ id: 5, sessionId: 'ses_5' }),
      entry({ id: 6, sessionId: 'ses_6' }),
    ],
  })

  it('adds and removes started entries', () => {
    expect(toggleFusionSource(run, [], 2)).toEqual([2])
    expect(toggleFusionSource(run, [1, 2], 1)).toEqual([2])
  })

  it('keeps the selection in run order regardless of toggle order', () => {
    expect(toggleFusionSource(run, [4], 1)).toEqual([1, 4])
    expect(toggleFusionSource(run, [5, 2], 4)).toEqual([2, 4, 5])
  })

  it('ignores entries that are not started and selections past the model limit', () => {
    expect(toggleFusionSource(run, [], 3)).toEqual([])
    expect(toggleFusionSource(run, [1, 2, 4, 5, 6], 99)).toEqual([1, 2, 4, 5, 6])
  })
})

describe('parseFusionForm', () => {
  it('builds the fusion request without an isolate field and omits blank optional fields', () => {
    expect(parseFusionForm({ entryIds: [1, 2], model: 'anthropic/claude', baseRef: ' ', instructions: ' ' }, UUID)).toEqual({
      ok: true,
      value: { requestId: UUID, entryIds: [1, 2], model: 'anthropic/claude' },
    })
    expect(
      parseFusionForm({ entryIds: [1, 2], model: 'anthropic/claude', baseRef: 'main', instructions: ' keep tests ' }, UUID),
    ).toEqual({
      ok: true,
      value: { requestId: UUID, entryIds: [1, 2], model: 'anthropic/claude', baseRef: 'main', instructions: 'keep tests' },
    })
  })

  it('rejects fewer than two sources or a missing model', () => {
    expect(parseFusionForm({ entryIds: [1], model: 'a/b', baseRef: '', instructions: '' }, UUID)).toEqual({
      ok: false,
      error: 'Select at least 2 started results to fuse.',
    })
    expect(parseFusionForm({ entryIds: [1, 2], model: '', baseRef: '', instructions: '' }, UUID)).toEqual({
      ok: false,
      error: 'Choose a synthesis model.',
    })
  })
})

describe('describeMultiRunError', () => {
  it('reports an outdated Manager when the route is missing', () => {
    expect(describeMultiRunError(new ManagerApiError('not found', 404, null, 'list multi-runs'))).toEqual({
      message: MULTI_RUN_ROUTE_MISSING,
    })
  })

  it('lists each unavailable fusion source', () => {
    const error = new ManagerApiError('conflict', 409, null, 'fuse multi-run', {
      unavailableSources: [
        { entryId: 1, model: 'openai/gpt-5', reason: 'running', message: 'still running' },
        { entryId: 2, model: 'anthropic/claude', reason: 'failed', message: 'failed' },
      ],
    })
    expect(describeMultiRunError(error)).toEqual({ message: 'openai/gpt-5: still running\nanthropic/claude: failed' })
  })

  it('returns the session of a recovered fusion attempt when the Manager sent no machine code', () => {
    const error = new ManagerApiError('conflict', 409, null, 'fuse multi-run', {
      fusions: [{ fusionId: 4, sessionId: 'ses_recovered' }],
    })
    expect(describeMultiRunError(error)).toEqual({
      message: 'An earlier fusion attempt is already running.',
      recoveredSessionId: 'ses_recovered',
    })
  })

  it('recovers only when the machine code marks the attempt recovered', () => {
    const details = { fusions: [{ fusionId: 4, sessionId: 'ses_recovered' }] }
    expect(describeMultiRunError(new ManagerApiError('conflict', 409, 'FUSION_ATTEMPT_RECOVERED', 'fuse multi-run', details))).toEqual({
      message: 'An earlier fusion attempt is already running.',
      recoveredSessionId: 'ses_recovered',
    })
    expect(describeMultiRunError(new ManagerApiError('context limit', 409, 'FUSION_CONTEXT_LIMIT', 'fuse multi-run', details))).toEqual({
      message: 'context limit',
    })
  })

  it('falls back to the error message', () => {
    expect(describeMultiRunError(new ManagerApiError('launch failed (500)', 500, null, 'launch multi-run'))).toEqual({
      message: 'launch failed (500)',
    })
    expect(describeMultiRunError(new Error('offline'))).toEqual({ message: 'offline' })
  })
})

describe('runMultiRunCommand', () => {
  it('refuses when not attached to a Manager repo', async () => {
    const manager = createManager()
    const fake = createFakeContext()
    const withoutRemote = { ...depsFor(), remote: undefined }
    const withoutRepo = { ...depsFor(), remote: { ...remote, repoId: undefined } }

    await runMultiRunCommand(fake.context, withoutRemote, '/ocm-multirun fix it')
    await runMultiRunCommand(fake.context, withoutRepo)

    expect(fake.toast).toHaveBeenCalledTimes(2)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: MULTI_RUN_ATTACH_REQUIRED })
    expect(withoutRemote.showLaunchDialog).not.toHaveBeenCalled()
    expect(withoutRepo.showRunsDialog).not.toHaveBeenCalled()
    expect(manager.requests).toHaveLength(0)
  })

  it('reports an auth failure without opening a dialog', async () => {
    createManager()
    const fake = createFakeContext()
    const deps = { ...depsFor(), auth: authDeps(async () => null) }

    await runMultiRunCommand(fake.context, deps)

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'error',
      message: `no token stored for ${remote.managerUrl} (${STORE_LABEL}). Run \`ocm login ${remote.managerUrl}\`.`,
    })
    expect(deps.showRunsDialog).not.toHaveBeenCalled()
  })

  it('lists the attached repo through the authenticated manager api', async () => {
    const manager = createManager({ list: () => Response.json({ runs: [multiRun()] }) })
    const fake = createFakeContext()
    const deps = depsFor()

    await runMultiRunCommand(fake.context, deps)
    const actions = deps.showRunsDialog.mock.calls[0]![0].actions
    await expect(actions.list()).resolves.toEqual({ ok: true, value: [multiRun()] })

    expect(manager.requestsTo('/api/internal/multi-runs?repoId=1')).toEqual([
      { method: 'GET', url: '/api/internal/multi-runs?repoId=1', authorization: 'Bearer tok', body: null },
    ])
  })

  it('opens the launch dialog prefilled with the slash argument after listing runs', async () => {
    const manager = createManager()
    const fake = createFakeContext()
    const deps = depsFor()

    await runMultiRunCommand(fake.context, deps, '/ocm-multirun  fix the flaky test ')

    expect(manager.requestsTo('/api/internal/multi-runs?repoId=1')).toHaveLength(1)
    expect(deps.showLaunchDialog).toHaveBeenCalledWith({ actions: expect.any(Object), initialPrompt: 'fix the flaky test' })
    expect(deps.showRunsDialog).not.toHaveBeenCalled()
  })

  it('does not open the launch dialog when the Manager cannot list multi-runs', async () => {
    createManager({ list: () => new Response('not found', { status: 404 }) })
    const fake = createFakeContext()
    const deps = depsFor()

    await runMultiRunCommand(fake.context, deps, '/ocm-multirun hello')

    expect(deps.showLaunchDialog).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: MULTI_RUN_ROUTE_MISSING })
  })

  it('opens the runs dialog without a prompt, whose new action opens an empty launch dialog', async () => {
    createManager()
    const fake = createFakeContext()
    const deps = depsFor()

    await runMultiRunCommand(fake.context, deps, '/ocm-multirun')
    deps.showRunsDialog.mock.calls[0]![0].newRun()

    expect(deps.showLaunchDialog).toHaveBeenCalledWith({ actions: expect.any(Object), initialPrompt: '' })
  })
})

describe('multi-run dialog actions', () => {
  it('launches, toasts the result, and opens the started sessions', async () => {
    const manager = createManager({
      launch: () => Response.json({ run: multiRun({ name: 'fix the flaky test', entries: [entry({ id: 1, sessionId: 'ses_1' }), entry({ id: 2, sessionId: 'ses_2' })] }) }),
    })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.launch(launchForm())).resolves.toBeNull()

    expect(manager.requestsTo('/api/internal/multi-runs')).toContainEqual({
      method: 'POST',
      url: '/api/internal/multi-runs',
      authorization: 'Bearer tok',
      body: {
        repoId: 1,
        name: 'fix the flaky test',
        prompt: 'fix the flaky test',
        models: ['openai/gpt-5'],
        isolate: true,
      },
    })
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'success', message: 'Launched fix the flaky test: 2/2 started' })
    expect(fake.open).toHaveBeenCalledWith('ses_1')
    expect(fake.open).toHaveBeenCalledWith('ses_2')
  })

  it('warns about failed entries after a launch', async () => {
    const manager = createManager({
      launch: () => Response.json({
        run: multiRun({ entries: [entry(), entry({ id: 2, model: 'anthropic/claude', status: 'failed', sessionId: null, error: 'quota' })] }),
      }),
    })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await actions.launch(launchForm())

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'warning', message: 'Launched sweep: 1/2 started\nanthropic/claude: quota' })
  })

  it('errors when no entry started', async () => {
    const manager = createManager({
      launch: () => Response.json({
        run: multiRun({
          entries: [
            entry({ id: 1, status: 'failed', sessionId: null, error: 'quota' }),
            entry({ id: 2, model: 'anthropic/claude', status: 'failed', sessionId: null, error: 'quota' }),
          ],
        }),
      }),
    })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await actions.launch(launchForm())

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'error',
      message: 'Launched sweep: 0/2 started\nopenai/gpt-5: quota\nanthropic/claude: quota',
    })
  })

  it('returns validation and API errors from launch without toasting', async () => {
    const manager = createManager({ launch: () => new Response('not found', { status: 404 }) })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.launch(launchForm({ models: [] }))).resolves.toBe('Choose at least one model.')
    await expect(actions.launch(launchForm())).resolves.toBe(MULTI_RUN_ROUTE_MISSING)
    expect(fake.toast).not.toHaveBeenCalled()
  })

  it('lists runs for the attached repo', async () => {
    const manager = createManager({ list: () => Response.json({ runs: [multiRun()] }) })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.list()).resolves.toEqual({ ok: true, value: [multiRun()] })
    expect(manager.requestsTo('/api/internal/multi-runs?repoId=1')).toHaveLength(2)
  })

  it('discards an entry and returns the updated run', async () => {
    const updated = multiRun({ entries: [entry({ status: 'discarded' })] })
    const manager = createManager({ discard: () => Response.json({ run: updated }) })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.discard(multiRun(), entry())).resolves.toEqual({ ok: true, value: updated })
    expect(manager.requestsTo('/multi-runs/3/entries/1/discard')).toEqual([
      { method: 'POST', url: '/api/internal/multi-runs/3/entries/1/discard', authorization: 'Bearer tok', body: null },
    ])
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'success', message: 'Discarded openai/gpt-5' })
  })

  it('fuses with a fresh request id and opens the fusion session', async () => {
    const manager = createManager()
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBeNull()

    const [fuseRequest] = manager.requestsTo('/fusions')
    expect(fuseRequest?.body).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), entryIds: [1, 2], model: 'anthropic/claude' })
    expect(fuseRequest?.body).not.toHaveProperty('isolate')
    expect(fake.open).toHaveBeenCalledWith('ses_f')
  })

  it('reports a failed fusion', async () => {
    const manager = createManager({ fuse: fuseResponding({ status: 'failed', sessionId: null, error: 'context limit' }) })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBe('context limit')
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('reuses the fusion request id across reopened commands while a network error leaves the outcome unknown', async () => {
    let fuses = 0
    const manager = createManager({
      fuse: (request) => {
        fuses += 1
        if (fuses <= 2) throw new Error('offline')
        return fuseResponding()(request)
      },
    })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)
    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBe('offline')
    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBe('offline')
    const reopened = await launchActions(createFakeContext(), manager)
    await expect(reopened.fuse(multiRun(), fusionForm())).resolves.toBeNull()

    const requestIds = manager.requestsTo('/fusions').map((request) => z.string().parse(request.body?.requestId))
    expect(requestIds).toHaveLength(3)
    expect(requestIds[1]).toBe(requestIds[0])
    expect(requestIds[2]).toBe(requestIds[0])
  })

  it('mints a fresh fusion request id once the Manager has answered', async () => {
    let fuses = 0
    const manager = createManager({
      fuse: (request) => {
        fuses += 1
        if (fuses === 1) return new Response('boom', { status: 500 })
        return fuseResponding()(request)
      },
    })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBe('fuse multi-run failed (500): boom')
    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBeNull()

    const requestIds = manager.requestsTo('/fusions').map((request) => z.string().parse(request.body?.requestId))
    expect(requestIds[1]).not.toBe(requestIds[0])
  })

  it('opens the recovered fusion session instead of failing', async () => {
    const manager = createManager({
      fuse: () => new Response(JSON.stringify({ error: 'conflict', code: 'FUSION_ATTEMPT_RECOVERED', details: { fusions: [{ fusionId: 4, sessionId: 'ses_recovered' }] } }), { status: 409 }),
    })
    const fake = createFakeContext()
    const actions = await launchActions(fake, manager)

    await expect(actions.fuse(multiRun(), fusionForm())).resolves.toBeNull()
    expect(fake.open).toHaveBeenCalledWith('ses_recovered')
    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'info',
      message: 'An earlier fusion attempt is already running. Opened it instead.',
    })
  })
})
