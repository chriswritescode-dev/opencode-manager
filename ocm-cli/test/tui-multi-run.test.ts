import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import type { ModelInfo } from '@opencode/client'
import type { MultiRun, MultiRunEntry } from '@opencode-manager/shared/schemas'
import {
  listModelOptions,
  openManagerSessions,
  runMultiRunCommand,
  MULTI_RUN_ATTACH_REQUIRED,
  MULTI_RUN_ROUTE_MISSING,
} from '../src/tui-multi-run.js'
import { ManagerApiError } from '../src/manager-api.js'
import type { ManagerApi } from '../src/manager-api.js'
import { resolveManagerAuth } from '../src/manager-auth.js'
import type { RemoteContext } from '../src/remote-context.js'

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

  it('asks for the prompt when the command has none', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.list.mockReturnValue([model()])
    fake.prompt.mockResolvedValueOnce('from dialog').mockResolvedValueOnce('sweep').mockResolvedValueOnce(undefined)
    fake.select.mockResolvedValueOnce(0).mockResolvedValueOnce(-1).mockResolvedValueOnce(true)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

    expect(fake.prompt).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: 'Multi-run prompt' }))
    expect(api.launchMultiRun).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'from dialog' }))
  })

  it('does nothing when the prompt dialog is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    fake.prompt.mockResolvedValueOnce(undefined)

    await runMultiRunCommand(fake.context, depsFor(api), '/multirun')

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
