import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import type { SessionGoal } from '@opencode-manager/shared/schemas'
import {
  runGoalCommand,
  formatGoalStatus,
  goalOutcomeToast,
  GOALS_ATTACH_REQUIRED,
  GOALS_ROUTE_MISSING,
} from '../src/tui-goal.js'
import { ManagerApiError } from '../src/manager-api.js'
import type { ManagerApi } from '../src/manager-api.js'
import { resolveManagerAuth } from '../src/manager-auth.js'
import type { GoalStore } from '../src/goal-store.js'
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

function goal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    id: 7,
    sessionId: 'ses_a',
    directory: '/repo',
    objective: 'fix it',
    status: 'active',
    stopReason: null,
    turnState: 'waiting',
    continuationCount: 0,
    maxContinuations: 5,
    tokenBudget: null,
    tokensUsed: 0,
    consecutiveBlocked: 0,
    lastVerdict: null,
    lastReason: null,
    createdAt: 1,
    updatedAt: 1,
    finishedAt: null,
    ...overrides,
  }
}

function createFakeContext(route: { type: string; sessionID?: string } = { type: 'session', sessionID: 'ses_a' }) {
  const toast = vi.fn()
  const select = vi.fn()
  const dialogPrompt = vi.fn()
  const sessionPrompt = vi.fn()
  const status = vi.fn(() => 'idle')
  const context = {
    ui: {
      router: { current: () => route },
      toast: { show: toast },
      dialog: { prompt: dialogPrompt, select },
    },
    data: {
      session: {
        get: () => ({ location: { directory: '/repo' } }),
        status,
      },
    },
    client: { session: { prompt: sessionPrompt } },
  } as unknown as Context
  return { context, toast, select, dialogPrompt, sessionPrompt, status }
}

function makeApi() {
  return {
    getLatestSessionGoal: vi.fn(async () => null as SessionGoal | null),
    startSessionGoal: vi.fn(),
    pauseSessionGoal: vi.fn(),
    resumeSessionGoal: vi.fn(),
    cancelSessionGoal: vi.fn(),
  }
}

function makeStore() {
  const set = vi.fn()
  const store: GoalStore = {
    watch: vi.fn(() => () => undefined),
    set,
    refresh: vi.fn(async () => undefined),
  }
  return { store, set }
}

function depsFor(api: ReturnType<typeof makeApi>, store: GoalStore, createApi = vi.fn(() => api as unknown as ManagerApi)) {
  return { remote, store, createApi }
}

beforeEach(() => {
  vi.mocked(resolveManagerAuth).mockReset()
  vi.mocked(resolveManagerAuth).mockResolvedValue({ ok: true, managerUrl: remote.managerUrl, token: 'tok' })
})

describe('formatGoalStatus', () => {
  it('renders the outcome, turn counter, token budget and objective', () => {
    expect(
      formatGoalStatus(goal({ status: 'active', continuationCount: 2, maxContinuations: 5, tokenBudget: 1000, tokensUsed: 250 })),
    ).toBe('Goal active · turn 2/5 · 250/1000 tokens · fix it')
  })

  it('omits the token budget when there is none', () => {
    expect(formatGoalStatus(goal({ status: 'paused', tokenBudget: null }))).toBe('Goal paused · turn 0/5 · fix it')
  })
})

describe('goalOutcomeToast', () => {
  it('maps completed to success with the last reason', () => {
    expect(goalOutcomeToast(goal({ status: 'completed', lastReason: 'all green' }))).toEqual({
      variant: 'success',
      title: 'Goal completed',
      message: 'all green',
    })
  })

  it('maps blocked to error and falls back to the objective', () => {
    expect(goalOutcomeToast(goal({ status: 'blocked', lastReason: null, objective: 'fix it' }))).toEqual({
      variant: 'error',
      title: 'Goal blocked',
      message: 'fix it',
    })
  })

  it('maps stopped to warning and prefers the stop reason label', () => {
    expect(goalOutcomeToast(goal({ status: 'stopped', stopReason: 'cancelled' }))).toEqual({
      variant: 'warning',
      title: 'Goal stopped',
      message: 'Cancelled',
    })
  })
})

describe('runGoalCommand', () => {
  it('refuses when not attached to a Manager', async () => {
    const fake = createFakeContext()
    const { store } = makeStore()
    const createApi = vi.fn()

    await runGoalCommand(fake.context, { remote: undefined, store, createApi }, '/goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: GOALS_ATTACH_REQUIRED })
    expect(createApi).not.toHaveBeenCalled()
  })

  it('refuses when no goal store is available', async () => {
    const fake = createFakeContext()

    await runGoalCommand(fake.context, { remote, store: undefined }, '/goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: GOALS_ATTACH_REQUIRED })
  })

  it('refuses outside a session', async () => {
    const fake = createFakeContext({ type: 'home' })
    const { store } = makeStore()
    const createApi = vi.fn()

    await runGoalCommand(fake.context, { remote, store, createApi }, '/goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'Not in a session' })
    expect(createApi).not.toHaveBeenCalled()
  })

  it('reports an auth failure without calling the API', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const { store } = makeStore()
    vi.mocked(resolveManagerAuth).mockResolvedValue({ ok: false, message: 'No token stored. Run `ocm login https://manager.example`.' })

    await runGoalCommand(fake.context, depsFor(api, store), '/goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'error',
      message: 'No token stored. Run `ocm login https://manager.example`.',
    })
    expect(api.getLatestSessionGoal).not.toHaveBeenCalled()
  })

  it('starts a goal and sends the objective as the next message', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const started = goal({ status: 'active' })
    api.startSessionGoal.mockResolvedValue(started)
    const { store, set } = makeStore()
    fake.sessionPrompt.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, depsFor(api, store), '/goal Fix the flaky test')

    expect(api.startSessionGoal).toHaveBeenCalledWith({ sessionId: 'ses_a', directory: '/repo', objective: 'Fix the flaky test' })
    expect(set).toHaveBeenCalledWith(started)
    expect(fake.sessionPrompt).toHaveBeenCalledWith({ sessionID: 'ses_a', text: 'Fix the flaky test', delivery: undefined })
    expect(api.startSessionGoal.mock.invocationCallOrder[0]).toBeLessThan(fake.sessionPrompt.mock.invocationCallOrder[0])
  })

  it('queues the prompt while the session is running', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.startSessionGoal.mockResolvedValue(goal())
    const { store } = makeStore()
    fake.status.mockReturnValue('running')
    fake.sessionPrompt.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, depsFor(api, store), '/goal Fix it')

    expect(fake.sessionPrompt).toHaveBeenCalledWith(expect.objectContaining({ delivery: 'queue' }))
  })

  it('prompts for the objective when the command has none', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.startSessionGoal.mockResolvedValue(goal())
    const { store } = makeStore()
    fake.dialogPrompt.mockResolvedValue('from dialog')
    fake.sessionPrompt.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, depsFor(api, store), '/goal')

    expect(fake.dialogPrompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Start goal' }))
    expect(api.startSessionGoal).toHaveBeenCalledWith(expect.objectContaining({ objective: 'from dialog' }))
  })

  it('does nothing when the start prompt is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const { store } = makeStore()
    fake.dialogPrompt.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, depsFor(api, store), '/goal')

    expect(api.startSessionGoal).not.toHaveBeenCalled()
    expect(fake.sessionPrompt).not.toHaveBeenCalled()
  })

  it('cancels the goal when sending the objective fails', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const started = goal({ status: 'active' })
    const cancelled = goal({ status: 'stopped', stopReason: 'cancelled' })
    api.startSessionGoal.mockResolvedValue(started)
    api.cancelSessionGoal.mockResolvedValue(cancelled)
    const { store, set } = makeStore()
    fake.sessionPrompt.mockRejectedValue(new Error('send failed'))

    await runGoalCommand(fake.context, depsFor(api, store), '/goal Fix it')

    expect(api.cancelSessionGoal).toHaveBeenCalledWith(started.id)
    expect(set).toHaveBeenLastCalledWith(cancelled)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'send failed' })
  })

  it('still reports the send failure when cancelling fails', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.startSessionGoal.mockResolvedValue(goal())
    api.cancelSessionGoal.mockRejectedValue(new Error('cancel failed'))
    const { store, set } = makeStore()
    fake.sessionPrompt.mockRejectedValue(new Error('send failed'))

    await runGoalCommand(fake.context, depsFor(api, store), '/goal Fix it')

    expect(set).toHaveBeenCalledTimes(1)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'send failed' })
  })

  it('offers pause and cancel for an active goal', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const active = goal({ status: 'active' })
    const paused = goal({ status: 'paused' })
    api.getLatestSessionGoal.mockResolvedValue(active)
    api.pauseSessionGoal.mockResolvedValue(paused)
    const { store, set } = makeStore()
    fake.select.mockResolvedValue('pause')

    await runGoalCommand(fake.context, depsFor(api, store), '/goal')

    const options = fake.select.mock.calls[0][0].options as { title: string }[]
    expect(options.map((option) => option.title)).toEqual(['Pause goal', 'Cancel goal'])
    expect(api.pauseSessionGoal).toHaveBeenCalledWith(active.id)
    expect(set).toHaveBeenCalledWith(paused)
    expect(api.startSessionGoal).not.toHaveBeenCalled()
  })

  it('offers resume and cancel for a paused goal', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const paused = goal({ status: 'paused' })
    const resumed = goal({ status: 'active' })
    api.getLatestSessionGoal.mockResolvedValue(paused)
    api.resumeSessionGoal.mockResolvedValue(resumed)
    const { store, set } = makeStore()
    fake.select.mockResolvedValue('resume')

    await runGoalCommand(fake.context, depsFor(api, store), '/goal')

    const options = fake.select.mock.calls[0][0].options as { title: string }[]
    expect(options.map((option) => option.title)).toEqual(['Resume goal', 'Cancel goal'])
    expect(api.resumeSessionGoal).toHaveBeenCalledWith(paused.id)
    expect(set).toHaveBeenCalledWith(resumed)
  })

  it('cancels an open goal', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const active = goal({ status: 'active' })
    const stopped = goal({ status: 'stopped', stopReason: 'cancelled' })
    api.getLatestSessionGoal.mockResolvedValue(active)
    api.cancelSessionGoal.mockResolvedValue(stopped)
    const { store, set } = makeStore()
    fake.select.mockResolvedValue('cancel')

    await runGoalCommand(fake.context, depsFor(api, store), '/goal')

    expect(api.cancelSessionGoal).toHaveBeenCalledWith(active.id)
    expect(set).toHaveBeenCalledWith(stopped)
  })

  it('does nothing when the goal action dialog is dismissed', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.getLatestSessionGoal.mockResolvedValue(goal({ status: 'active' }))
    const { store, set } = makeStore()
    fake.select.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, depsFor(api, store), '/goal')

    expect(api.pauseSessionGoal).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('reports a Manager API error message', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.getLatestSessionGoal.mockRejectedValue(new ManagerApiError('read failed', 500, 'boom', 'read session goal'))
    const { store } = makeStore()

    await runGoalCommand(fake.context, depsFor(api, store), '/goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'read failed' })
  })

  it('reports an outdated Manager when the goal route is missing', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.getLatestSessionGoal.mockRejectedValue(new ManagerApiError('not found', 404, null, 'read session goal'))
    const { store } = makeStore()

    await runGoalCommand(fake.context, depsFor(api, store), '/goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: GOALS_ROUTE_MISSING })
  })
})
