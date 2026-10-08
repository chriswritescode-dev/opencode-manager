import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import type { SessionGoal } from '@opencode-manager/shared/schemas'
import {
  runGoalCommand,
  formatGoalStatus,
  goalObjectiveSummary,
  goalOutcomeToast,
  parseGoalForm,
  GOALS_ATTACH_REQUIRED,
  GOALS_ROUTE_MISSING,
} from '../src/tui-goal.js'
import type { GoalActions } from '../src/tui-goal.js'
import { ManagerApiError } from '../src/manager-api.js'
import type { ManagerApi } from '../src/manager-api.js'
import { resolveManagerApi } from '../src/manager-auth.js'
import type { GoalStore } from '../src/goal-store.js'
import type { RemoteContext } from '../src/remote-context.js'
import { goal } from './helpers/goal-fixture.js'

vi.mock('../src/manager-auth.js', () => ({
  resolveManagerApi: vi.fn(),
}))

const remote: RemoteContext = {
  managerUrl: 'https://manager.example',
  managerHost: 'manager.example',
  repoName: 'repo',
  repoId: 1,
}

function createFakeContext(
  route: { type: string; sessionID?: string } = { type: 'session', sessionID: 'ses_a' },
  session: unknown = { location: { directory: '/repo' } },
) {
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
        get: () => session,
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
  }
  return { store, set }
}

function depsFor(api: ReturnType<typeof makeApi>, store: GoalStore) {
  vi.mocked(resolveManagerApi).mockResolvedValue({
    ok: true,
    auth: { ok: true, managerUrl: remote.managerUrl, token: 'tok' },
    api: api as unknown as ManagerApi,
  })
  return { remote, store, showDialog: vi.fn() }
}

async function dialogActions(fake: ReturnType<typeof createFakeContext>, api: ReturnType<typeof makeApi>, store: GoalStore): Promise<GoalActions> {
  const deps = depsFor(api, store)
  await runGoalCommand(fake.context, deps, '/ocm-goal')
  return deps.showDialog.mock.calls[0]![0].actions
}

const blankLimits = { maxTurns: '', tokenBudget: '' }

beforeEach(() => {
  vi.mocked(resolveManagerApi).mockReset()
})

describe('goalObjectiveSummary', () => {
  it('keeps the first line of a multi-line objective', () => {
    expect(goalObjectiveSummary('fix it\nand more')).toBe('fix it')
  })

  it('leaves a short single line unchanged', () => {
    expect(goalObjectiveSummary('fix it')).toBe('fix it')
  })

  it('cuts a long first line and appends an ellipsis', () => {
    expect(goalObjectiveSummary('x'.repeat(70))).toBe(`${'x'.repeat(60)}…`)
  })
})

describe('formatGoalStatus', () => {
  it('renders the outcome, shared turn and token labels, and objective', () => {
    expect(
      formatGoalStatus(goal({ status: 'active', continuationCount: 2, maxContinuations: 5, tokenBudget: 1000, tokensUsed: 250 })),
    ).toBe(`Goal active · Turn 2/5 · 250/${(1000).toLocaleString()} tokens · fix it`)
  })

  it('omits the token budget when there is none', () => {
    expect(formatGoalStatus(goal({ status: 'paused', tokenBudget: null }))).toBe('Goal paused · Turn 0/5 · fix it')
  })

  it('renders one line using only the objective first line', () => {
    expect(formatGoalStatus(goal({ status: 'active', objective: 'fix it\nsecond line' }))).toBe('Goal active · Turn 0/5 · fix it')
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

  it('summarizes a long objective fallback', () => {
    expect(goalOutcomeToast(goal({ status: 'blocked', lastReason: null, objective: 'x'.repeat(70) })).message).toBe(`${'x'.repeat(60)}…`)
  })
})

describe('parseGoalForm', () => {
  it('trims the objective and leaves blank limits to the Manager defaults', () => {
    expect(parseGoalForm({ objective: '  fix it ', ...blankLimits }, 'ses_a', '/repo')).toEqual({
      ok: true,
      request: { sessionId: 'ses_a', directory: '/repo', objective: 'fix it' },
    })
  })

  it('passes explicit limits through', () => {
    expect(parseGoalForm({ objective: 'fix it', maxTurns: ' 12 ', tokenBudget: '50000' }, 'ses_a', '/repo')).toEqual({
      ok: true,
      request: { sessionId: 'ses_a', directory: '/repo', objective: 'fix it', maxContinuations: 12, tokenBudget: 50000 },
    })
  })

  it('rejects a blank objective and out-of-range or non-numeric limits', () => {
    expect(parseGoalForm({ objective: ' ', ...blankLimits }, 'ses_a', '/repo')).toEqual({
      ok: false,
      error: 'Describe what this session should accomplish.',
    })
    for (const maxTurns of ['0', '201', 'ten', '1.5']) {
      expect(parseGoalForm({ objective: 'x', maxTurns, tokenBudget: '' }, 'ses_a', '/repo')).toEqual({
        ok: false,
        error: 'Max turns must be a whole number from 1 to 200.',
      })
    }
    for (const tokenBudget of ['0', '-5', 'lots']) {
      expect(parseGoalForm({ objective: 'x', maxTurns: '', tokenBudget }, 'ses_a', '/repo')).toEqual({
        ok: false,
        error: 'Token budget must be a positive whole number.',
      })
    }
  })
})

describe('runGoalCommand', () => {
  it('refuses when not attached to a Manager or without a goal store', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const { store } = makeStore()
    const detached = { ...depsFor(api, store), remote: undefined }
    const storeless = { ...depsFor(api, store), store: undefined }

    await runGoalCommand(fake.context, detached, '/ocm-goal fix it')
    await runGoalCommand(fake.context, storeless, '/ocm-goal fix it')

    expect(fake.toast).toHaveBeenCalledTimes(2)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: GOALS_ATTACH_REQUIRED })
    expect(vi.mocked(resolveManagerApi)).not.toHaveBeenCalled()
  })

  it('refuses outside a session', async () => {
    const fake = createFakeContext({ type: 'home' })
    const { store } = makeStore()
    const deps = depsFor(makeApi(), store)

    await runGoalCommand(fake.context, deps, '/ocm-goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'Not in a session' })
    expect(vi.mocked(resolveManagerApi)).not.toHaveBeenCalled()
  })

  it('refuses when the session has no directory', async () => {
    const fake = createFakeContext({ type: 'session', sessionID: 'ses_a' }, { location: {} })
    const { store } = makeStore()
    const deps = depsFor(makeApi(), store)

    await runGoalCommand(fake.context, deps, '/ocm-goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'Session has no directory' })
    expect(vi.mocked(resolveManagerApi)).not.toHaveBeenCalled()
  })

  it('reports an auth failure without calling the API', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const { store } = makeStore()
    const deps = depsFor(api, store)
    vi.mocked(resolveManagerApi).mockResolvedValue({ ok: false, message: 'No token stored. Run `ocm login https://manager.example`.' })

    await runGoalCommand(fake.context, deps, '/ocm-goal fix it')

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'error',
      message: 'No token stored. Run `ocm login https://manager.example`.',
    })
    expect(api.getLatestSessionGoal).not.toHaveBeenCalled()
  })

  it('starts a goal directly from the slash argument and sends the objective as the next message', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const started = goal({ status: 'active' })
    api.startSessionGoal.mockResolvedValue(started)
    const { store, set } = makeStore()
    const deps = depsFor(api, store)
    fake.sessionPrompt.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, deps, '/ocm-goal Fix the flaky test')

    expect(vi.mocked(resolveManagerApi)).toHaveBeenCalledWith(remote.managerUrl)
    expect(api.startSessionGoal).toHaveBeenCalledWith({ sessionId: 'ses_a', directory: '/repo', objective: 'Fix the flaky test' })
    expect(set).toHaveBeenCalledWith(started)
    expect(fake.sessionPrompt).toHaveBeenCalledWith({ sessionID: 'ses_a', text: 'Fix the flaky test', delivery: undefined })
    expect(api.startSessionGoal.mock.invocationCallOrder[0]).toBeLessThan(fake.sessionPrompt.mock.invocationCallOrder[0])
    expect(deps.showDialog).not.toHaveBeenCalled()
  })

  it('queues the objective while the session is running', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.startSessionGoal.mockResolvedValue(goal())
    const { store } = makeStore()
    fake.status.mockReturnValue('running')
    fake.sessionPrompt.mockResolvedValue(undefined)

    await runGoalCommand(fake.context, depsFor(api, store), '/ocm-goal Fix it')

    expect(fake.sessionPrompt).toHaveBeenCalledWith(expect.objectContaining({ delivery: 'queue' }))
  })

  it('opens the dialog with the latest goal when the command has no objective', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const last = goal({ status: 'completed' })
    api.getLatestSessionGoal.mockResolvedValue(last)
    const { store } = makeStore()
    const deps = depsFor(api, store)

    await runGoalCommand(fake.context, deps, '/ocm-goal')

    expect(deps.showDialog).toHaveBeenCalledWith({
      sessionID: 'ses_a',
      store,
      initialGoal: last,
      initialObjective: '',
      actions: expect.any(Object),
    })
    expect(api.startSessionGoal).not.toHaveBeenCalled()
  })

  it('opens the dialog instead of starting when a goal is already open', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const active = goal({ status: 'active' })
    api.getLatestSessionGoal.mockResolvedValue(active)
    const { store } = makeStore()
    const deps = depsFor(api, store)

    await runGoalCommand(fake.context, deps, '/ocm-goal something else')

    expect(deps.showDialog).toHaveBeenCalledWith(expect.objectContaining({ initialGoal: active, initialObjective: 'something else' }))
    expect(api.startSessionGoal).not.toHaveBeenCalled()
  })

  it('reports Manager errors, including an outdated Manager', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const { store } = makeStore()
    api.getLatestSessionGoal.mockRejectedValueOnce(new ManagerApiError('read failed', 500, 'boom', 'read session goal'))
    api.getLatestSessionGoal.mockRejectedValueOnce(new ManagerApiError('not found', 404, null, 'read session goal'))

    await runGoalCommand(fake.context, depsFor(api, store), '/ocm-goal fix it')
    await runGoalCommand(fake.context, depsFor(api, store), '/ocm-goal fix it')

    expect(fake.toast).toHaveBeenNthCalledWith(1, { variant: 'error', message: 'read failed' })
    expect(fake.toast).toHaveBeenNthCalledWith(2, { variant: 'error', message: GOALS_ROUTE_MISSING })
  })
})

describe('goal dialog actions', () => {
  it('starts a goal with explicit limits', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.startSessionGoal.mockResolvedValue(goal())
    fake.sessionPrompt.mockResolvedValue(undefined)
    const { store } = makeStore()
    const actions = await dialogActions(fake, api, store)

    await expect(actions.start({ objective: 'fix it', maxTurns: '8', tokenBudget: '' })).resolves.toBeNull()

    expect(api.startSessionGoal).toHaveBeenCalledWith({ sessionId: 'ses_a', directory: '/repo', objective: 'fix it', maxContinuations: 8 })
  })

  it('returns a validation error without calling the API', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const { store } = makeStore()
    const actions = await dialogActions(fake, api, store)

    await expect(actions.start({ objective: 'fix it', maxTurns: '0', tokenBudget: '' })).resolves.toBe(
      'Max turns must be a whole number from 1 to 200.',
    )
    expect(api.startSessionGoal).not.toHaveBeenCalled()
  })

  it('cancels the goal and explains why when sending the objective fails', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const started = goal({ status: 'active' })
    const cancelled = goal({ status: 'stopped', stopReason: 'cancelled' })
    api.startSessionGoal.mockResolvedValue(started)
    api.cancelSessionGoal.mockResolvedValue(cancelled)
    fake.sessionPrompt.mockRejectedValue(new Error('send failed'))
    const { store, set } = makeStore()
    const actions = await dialogActions(fake, api, store)

    await expect(actions.start({ objective: 'fix it', ...blankLimits })).resolves.toBe(
      'The goal was cancelled because the objective could not be sent: send failed',
    )
    expect(api.cancelSessionGoal).toHaveBeenCalledWith(started.id)
    expect(set).toHaveBeenLastCalledWith(cancelled)
  })

  it('still reports the send failure when cancelling fails', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.startSessionGoal.mockResolvedValue(goal())
    api.cancelSessionGoal.mockRejectedValue(new Error('cancel failed'))
    fake.sessionPrompt.mockRejectedValue(new Error('send failed'))
    const { store, set } = makeStore()
    const actions = await dialogActions(fake, api, store)

    await expect(actions.start({ objective: 'fix it', ...blankLimits })).resolves.toMatch(/send failed$/)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('pauses, resumes, and cancels through the Manager and updates the store', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    const paused = goal({ status: 'paused' })
    const resumed = goal({ status: 'active' })
    const stopped = goal({ status: 'stopped', stopReason: 'cancelled' })
    api.pauseSessionGoal.mockResolvedValue(paused)
    api.resumeSessionGoal.mockResolvedValue(resumed)
    api.cancelSessionGoal.mockResolvedValue(stopped)
    const { store, set } = makeStore()
    const actions = await dialogActions(fake, api, store)

    await expect(actions.pause(goal())).resolves.toBeNull()
    await expect(actions.resume(paused)).resolves.toBeNull()
    await expect(actions.cancel(resumed)).resolves.toBeNull()

    expect(api.pauseSessionGoal).toHaveBeenCalledWith(7)
    expect(set.mock.calls.map((call) => call[0])).toEqual([paused, resumed, stopped])
  })

  it('returns a goal action failure as a message', async () => {
    const fake = createFakeContext()
    const api = makeApi()
    api.pauseSessionGoal.mockRejectedValue(new ManagerApiError('pause session goal failed (409): not active', 409, 'x', 'pause session goal'))
    const { store, set } = makeStore()
    const actions = await dialogActions(fake, api, store)

    await expect(actions.pause(goal())).resolves.toBe('pause session goal failed (409): not active')
    expect(set).not.toHaveBeenCalled()
  })
})
