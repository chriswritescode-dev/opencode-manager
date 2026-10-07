import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import type { ModelInfo } from '@opencode/client'
import type { MultiRun, MultiRunEntry } from '@opencode-manager/shared/schemas'
import {
  listModelOptions,
  openManagerSessions,
  runMultiRunCommand,
  formatEntryStatus,
  MULTI_RUN_ATTACH_REQUIRED,
  MULTI_RUN_ROUTE_MISSING,
} from '../src/tui-multi-run.js'
import { ManagerApiError } from '../src/manager-api.js'
import type { ManagerApi } from '../src/manager-api.js'
import { resolveManagerAuth } from '../src/manager-auth.js'
import type { RemoteContext } from '../src/remote-context.js'
import type { MultiRunFusion } from '@opencode-manager/shared/schemas'

vi.mock('../src/manager-auth.js', () => ({
  resolveManagerAuth: vi.fn(),
}))

const remote: RemoteContext = {
  managerUrl: 'https://manager.example',
  managerHost: 'manager.example',
  repoName: 'repo',
  repoId: 1,
}

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'gpt-5',
    modelID: 'gpt-5',
    providerID: 'openai',
    name: 'GPT-5',
    capabilities: {} as ModelInfo['capabilities'],
    variants: [],
    time: { released: 0 },
    cost: [],
    status: 'active',
    enabled: true,
    limit: { context: 0, output: 0 },
    ...overrides,
  } as ModelInfo
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

function createFakeContext() {
  const toast = vi.fn()
  const prompt = vi.fn()
  const select = vi.fn()
  const confirm = vi.fn()
  const open = vi.fn()
  const focus = vi.fn()
  const enabled = vi.fn(() => true)
  const navigate = vi.fn()
  const sync = vi.fn(async () => undefined)
  const list = vi.fn(() => [] as ModelInfo[])
  const context = {
    ui: {
      toast: { show: toast },
      dialog: { prompt, select, confirm },
      tabs: { enabled, open, focus },
      router: { navigate, current: () => ({ type: 'session', sessionID: 'ses_a' }) },
    },
    data: { location: { model: { sync, list } } },
  } as unknown as Context
  return { context, toast, prompt, select, confirm, open, focus, enabled, navigate, sync, list }
}

function makeApi() {
  return {
    launchMultiRun: vi.fn(async () => multiRun()),
    listMultiRuns: vi.fn(async () => [] as MultiRun[]),
    fuseMultiRun: vi.fn(async () => multiRun()),
    discardMultiRunEntry: vi.fn(async () => multiRun()),
  }
}

function depsFor(api: ReturnType<typeof makeApi>, createApi = vi.fn(() => api as unknown as ManagerApi)) {
  return { remote, createApi }
}

beforeEach(() => {
  vi.mocked(resolveManagerAuth).mockReset()
  vi.mocked(resolveManagerAuth).mockResolvedValue({ ok: true, managerUrl: remote.managerUrl, token: 'tok' })
})

describe('listModelOptions', () => {
  it('syncs then maps enabled, non-deprecated models to refs', async () => {
    const fake = createFakeContext()
    fake.list.mockReturnValue([
      model({ providerID: 'openai', id: 'gpt-5', name: 'GPT-5' }),
      model({ providerID: 'anthropic', id: 'claude', name: 'Claude' }),
      model({ providerID: 'openai', id: 'old', name: 'Old', status: 'deprecated' }),
      model({ providerID: 'openai', id: 'off', name: 'Off', enabled: false }),
    ])

    await expect(listModelOptions(fake.context)).resolves.toEqual([
      { title: 'GPT-5', description: 'openai/gpt-5', value: 'openai/gpt-5' },
      { title: 'Claude', description: 'anthropic/claude', value: 'anthropic/claude' },
    ])
    expect(fake.sync).toHaveBeenCalledTimes(1)
    expect(fake.sync.mock.invocationCallOrder[0]).toBeLessThan(fake.list.mock.invocationCallOrder[0])
  })

  it('tolerates a model list that is not loaded yet', async () => {
    const fake = createFakeContext()
    fake.list.mockReturnValue(undefined as unknown as ModelInfo[])

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

describe('runMultiRunCommand', () => {
  it('refuses when not attached to a Manager', async () => {
    const fake = createFakeContext()
    const createApi = vi.fn()

    await runMultiRunCommand(fake.context, { remote: undefined, createApi }, '/multirun fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: MULTI_RUN_ATTACH_REQUIRED })
    expect(createApi).not.toHaveBeenCalled()
  })

  it('refuses when the attach env carries no repo id', async () => {
    const fake = createFakeContext()
    const createApi = vi.fn()

    await runMultiRunCommand(fake.context, { remote: { ...remote, repoId: undefined }, createApi }, '/multirun fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: MULTI_RUN_ATTACH_REQUIRED })
    expect(createApi).not.toHaveBeenCalled()
  })

  it('launches with the chosen name, models, isolation and base ref, then opens the sessions', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({
      name: 'sweep',
      entries: [entry({ id: 1, sessionId: 'ses_1' }), entry({ id: 2, sessionId: 'ses_2' })],
    })
    api.launchMultiRun.mockResolvedValue(run)
    fake.list.mockReturnValue([
      model({ providerID: 'openai', id: 'gpt-5', name: 'GPT-5' }),
      model({ providerID: 'anthropic', id: 'claude', name: 'Claude' }),
    ])
    fake.prompt.mockResolvedValueOnce('sweep').mockResolvedValueOnce('main')
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(-1).mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix the bug')

    expect(fake.prompt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'Multi-run name', value: 'fix the bug' }),
    )
    expect(api.launchMultiRun).toHaveBeenCalledWith({
      repoId: 1,
      name: 'sweep',
      prompt: 'fix the bug',
      models: ['openai/gpt-5', 'anthropic/claude'],
      isolate: true,
      baseRef: 'main',
    })
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'success', message: 'Launched sweep: 2/2 started' })
    expect(fake.open).toHaveBeenNthCalledWith(1, 'ses_1')
    expect(fake.open).toHaveBeenNthCalledWith(2, 'ses_2')
    expect(fake.focus).toHaveBeenCalledWith('ses_1')
  })

  it('defaults the name to the first 80 characters of the prompt first line', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('name').mockResolvedValueOnce(undefined)
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(false)
    const longFirstLine = 'a'.repeat(100)

    await runMultiRunCommand(fake.context, depsFor(api), `/multirun ${longFirstLine}\nsecond line`)

    expect(fake.prompt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ value: 'a'.repeat(80) }),
    )
  })

  it('omits the base ref when isolation is off', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep')
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(false)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(api.launchMultiRun).toHaveBeenCalledWith({
      repoId: 1,
      name: 'sweep',
      prompt: 'fix it',
      models: ['openai/gpt-5'],
      isolate: false,
    })
    expect(fake.prompt).toHaveBeenCalledTimes(1)
  })

  it('omits the base ref when the base ref prompt is left blank', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep').mockResolvedValueOnce(undefined)
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(api.launchMultiRun).toHaveBeenCalledWith({
      repoId: 1,
      name: 'sweep',
      prompt: 'fix it',
      models: ['openai/gpt-5'],
      isolate: true,
    })
  })

  it('reports failed entries with a warning toast', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.launchMultiRun.mockResolvedValue(
      multiRun({
        name: 'sweep',
        entries: [
          entry({ id: 1, model: 'openai/gpt-5', sessionId: 'ses_1' }),
          entry({ id: 2, model: 'anthropic/claude', status: 'failed', sessionId: null, error: 'model unavailable' }),
        ],
      }),
    )
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep').mockResolvedValueOnce(undefined)
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'warning',
      message: 'Launched sweep: 1/2 started\nanthropic/claude: model unavailable',
    })
    expect(fake.open).toHaveBeenCalledTimes(1)
    expect(fake.open).toHaveBeenCalledWith('ses_1')
  })

  it('does not call the API when the name dialog is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.prompt.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(api.launchMultiRun).not.toHaveBeenCalled()
  })

  it('does not call the API when the model dialog is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep')
    fake.select.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(api.launchMultiRun).not.toHaveBeenCalled()
  })

  it('does not call the API when the isolation dialog is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep')
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(api.launchMultiRun).not.toHaveBeenCalled()
  })

  it('reports an auth failure without calling the API', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    vi.mocked(resolveManagerAuth).mockResolvedValue({ ok: false, message: 'No token stored.' })

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'No token stored.' })
    expect(api.launchMultiRun).not.toHaveBeenCalled()
  })

  it('reports a Manager API error message', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.launchMultiRun.mockRejectedValue(new ManagerApiError('launch failed', 500, 'boom', 'launch multi-run'))
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep').mockResolvedValueOnce(undefined)
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'launch failed' })
  })

  it('reports an outdated Manager when the multi-run route is missing', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.launchMultiRun.mockRejectedValue(new ManagerApiError('not found', 404, null, 'launch multi-run'))
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('sweep').mockResolvedValueOnce(undefined)
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: MULTI_RUN_ROUTE_MISSING })
  })
})

describe('runMultiRunCommand browse', () => {
  it('lists recent runs with a new multi-run option first', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.listMultiRuns.mockResolvedValue([
      multiRun({
        id: 3,
        name: 'sweep',
        entries: [entry({ id: 1, status: 'started' }), entry({ id: 2, status: 'failed', sessionId: null })],
        fusions: [fusion()],
      }),
    ])
    fake.select.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(api.listMultiRuns).toHaveBeenCalledWith(1)
    expect(fake.select).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Multi-runs',
        options: [
          { title: 'New multi-run…', value: { kind: 'new' } },
          expect.objectContaining({
            title: 'sweep',
            description: '2 models · 1 started · 1 fusions',
            value: expect.objectContaining({ kind: 'run' }),
          }),
        ],
      }),
    )
    expect(api.launchMultiRun).not.toHaveBeenCalled()
  })

  it('launches a new multi-run from the list', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.select
      .mockResolvedValueOnce({ kind: 'new' })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(-1)
      .mockResolvedValueOnce(false)
    fake.prompt.mockResolvedValueOnce('from list').mockResolvedValueOnce('sweep')

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.prompt).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: 'Multi-run prompt' }))
    expect(fake.prompt).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'Multi-run name' }))
    expect(api.launchMultiRun).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 1, prompt: 'from list', name: 'sweep' }),
    )
  })

  it('does nothing when the new multi-run prompt is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.select.mockResolvedValueOnce({ kind: 'new' })
    fake.prompt.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(api.launchMultiRun).not.toHaveBeenCalled()
  })

  it('opens an entry session from the run menu', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({ id: 3, name: 'sweep', entries: [entry({ id: 1, sessionId: 'ses_1' })], fusions: [] })
    api.listMultiRuns.mockResolvedValue([run])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'open', sessionId: 'ses_1' })

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: 'sweep',
        options: expect.arrayContaining([
          expect.objectContaining({
            title: 'Open openai/gpt-5',
            description: 'Started · isolated',
            value: { kind: 'open', sessionId: 'ses_1' },
          }),
        ]),
      }),
    )
    expect(fake.open).toHaveBeenCalledWith('ses_1')
    expect(fake.focus).toHaveBeenCalledWith('ses_1')
  })

  it('opens a fusion session from the run menu', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({ id: 3, name: 'sweep', entries: [], fusions: [fusion({ sessionId: 'ses_f' })] })
    api.listMultiRuns.mockResolvedValue([run])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'open', sessionId: 'ses_f' })

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ title: 'Open fusion anthropic/claude', value: { kind: 'open', sessionId: 'ses_f' } }),
        ]),
      }),
    )
    expect(fake.open).toHaveBeenCalledWith('ses_f')
  })

  it('disables fusion until enough results have started', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({ id: 3, name: 'sweep', entries: [entry({ id: 1, status: 'started' })], fusions: [] })
    api.listMultiRuns.mockResolvedValue([run])
    fake.select.mockResolvedValueOnce({ kind: 'run', run }).mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ title: 'Fuse results…', disabled: true, value: { kind: 'fuse' } }),
        ]),
      }),
    )
  })

  it('discards an entry after confirmation', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({ id: 3, name: 'sweep', entries: [entry({ id: 1, isolated: true })], fusions: [] })
    api.listMultiRuns.mockResolvedValue([run])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'discard', entry: run.entries[0] })
    fake.confirm.mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('workspace directory') }),
    )
    expect(api.discardMultiRunEntry).toHaveBeenCalledWith(3, 1)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'success', message: 'Discarded openai/gpt-5' })
  })

  it('uses the plain discard message for a shared entry and skips the API on decline', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({ id: 3, name: 'sweep', entries: [entry({ id: 1, isolated: false })], fusions: [] })
    api.listMultiRuns.mockResolvedValue([run])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'discard', entry: run.entries[0] })
    fake.confirm.mockResolvedValueOnce(false)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.not.stringContaining('workspace directory') }),
    )
    expect(api.discardMultiRunEntry).not.toHaveBeenCalled()
  })

  it('fuses selected results and opens the fusion session', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({
      id: 3,
      name: 'sweep',
      baseRef: 'main',
      entries: [
        entry({ id: 1, sessionId: 'ses_1', isolated: true }),
        entry({ id: 2, sessionId: 'ses_2', isolated: true }),
      ],
      fusions: [],
    })
    api.listMultiRuns.mockResolvedValue([run])
    api.fuseMultiRun.mockImplementation(async (_runId, request) =>
      multiRun({ fusions: [fusion({ requestId: request.requestId, sessionId: 'ses_f' })] }),
    )
    fake.list.mockReturnValue([model({ providerID: 'anthropic', id: 'claude', name: 'Claude' })])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'fuse' })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(-1)
      .mockResolvedValueOnce('anthropic/claude')
      .mockResolvedValueOnce(true)
    fake.prompt.mockResolvedValueOnce('compare').mockResolvedValueOnce('main')

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(api.fuseMultiRun).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        entryIds: [1, 2],
        model: 'anthropic/claude',
        instructions: 'compare',
        isolate: true,
        baseRef: 'main',
        requestId: expect.any(String),
      }),
    )
    expect(fake.prompt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: 'Start from', value: 'main' }),
    )
    expect(fake.open).toHaveBeenCalledWith('ses_f')
  })

  it('forces isolation when a selected source is not isolated', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({
      id: 3,
      name: 'sweep',
      entries: [
        entry({ id: 1, sessionId: 'ses_1', isolated: false }),
        entry({ id: 2, sessionId: 'ses_2', isolated: true }),
      ],
      fusions: [],
    })
    api.listMultiRuns.mockResolvedValue([run])
    api.fuseMultiRun.mockImplementation(async (_runId, request) =>
      multiRun({ fusions: [fusion({ requestId: request.requestId })] }),
    )
    fake.list.mockReturnValue([model({ providerID: 'anthropic', id: 'claude', name: 'Claude' })])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'fuse' })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(-1)
      .mockResolvedValueOnce('anthropic/claude')
    fake.prompt.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(api.fuseMultiRun).toHaveBeenCalledWith(3, expect.objectContaining({ isolate: true }))
    expect(fake.select).toHaveBeenCalledTimes(6)
  })

  it('reports a failed fusion', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({
      id: 3,
      name: 'sweep',
      entries: [entry({ id: 1, sessionId: 'ses_1' }), entry({ id: 2, sessionId: 'ses_2' })],
      fusions: [],
    })
    api.listMultiRuns.mockResolvedValue([run])
    api.fuseMultiRun.mockImplementation(async (_runId, request) =>
      multiRun({
        fusions: [fusion({ requestId: request.requestId, status: 'failed', sessionId: null, error: 'model overloaded' })],
      }),
    )
    fake.list.mockReturnValue([model()])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'fuse' })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(-1)
      .mockResolvedValueOnce('openai/gpt-5')
      .mockResolvedValueOnce(false)
    fake.prompt.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'model overloaded' })
    expect(fake.open).not.toHaveBeenCalled()
  })

  it('lists unavailable sources when the Manager rejects the fusion', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const run = multiRun({
      id: 3,
      name: 'sweep',
      entries: [entry({ id: 1, sessionId: 'ses_1' }), entry({ id: 2, sessionId: 'ses_2' })],
      fusions: [],
    })
    api.listMultiRuns.mockResolvedValue([run])
    api.fuseMultiRun.mockRejectedValue(
      new ManagerApiError('conflict', 409, 'FUSION_SOURCES_UNAVAILABLE', 'fuse multi-run', {
        unavailableSources: [
          { entryId: 1, model: 'openai/gpt-5', reason: 'not-started', message: 'has not started' },
          { entryId: 2, model: 'anthropic/claude', reason: 'failed', message: 'failed' },
        ],
      }),
    )
    fake.list.mockReturnValue([model()])
    fake.select
      .mockResolvedValueOnce({ kind: 'run', run })
      .mockResolvedValueOnce({ kind: 'fuse' })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(-1)
      .mockResolvedValueOnce('openai/gpt-5')
      .mockResolvedValueOnce(false)
    fake.prompt.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'error',
      message: 'openai/gpt-5: has not started\nanthropic/claude: failed',
    })
  })

  it('reports a list failure', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.listMultiRuns.mockRejectedValue(new ManagerApiError('list failed', 500, 'boom', 'list multi-runs'))

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'list failed' })
  })

  it('reports an outdated Manager when the list route is missing', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.listMultiRuns.mockRejectedValue(new ManagerApiError('not found', 404, null, 'list multi-runs'))

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: MULTI_RUN_ROUTE_MISSING })
  })
})
