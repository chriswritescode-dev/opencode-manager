import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import type { SessionTransferData } from '@opencode-manager/shared/opencode'
import { setupOcm } from '../src/tui-plugin.js'
import { moveReminderText } from '../src/session-move.js'

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  readState: vi.fn(),
  readInstallNotice: vi.fn(() => null),
  getToken: vi.fn(),
  fetchRepos: vi.fn(),
  toRemoteRepoSummaries: vi.fn((repos: unknown) => repos),
  prepareMirror: vi.fn(),
  checkPushDivergence: vi.fn(),
  describePushDivergence: vi.fn(() => []),
  mirrorUpFast: vi.fn(),
  pickMatchedRepo: vi.fn(),
  getBranchName: vi.fn(),
  createManagerSessionTransfer: vi.fn(),
  setPendingWarp: vi.fn(),
  runPendingWarp: vi.fn(),
  mirrorTargetPlan: vi.fn(),
  warmRepoProxy: vi.fn(),
}))

vi.mock('../src/state.js', () => ({
  readState: mocks.readState,
  readInstallNotice: mocks.readInstallNotice,
}))

vi.mock('../src/internal-token-store.js', () => ({ getToken: mocks.getToken }))

vi.mock('../src/manager-repos.js', () => ({
  fetchRepos: mocks.fetchRepos,
  toRemoteRepoSummaries: mocks.toRemoteRepoSummaries,
}))

vi.mock('../src/mirror.js', () => ({
  prepareMirror: mocks.prepareMirror,
  checkPushDivergence: mocks.checkPushDivergence,
  describePushDivergence: mocks.describePushDivergence,
  mirrorUpFast: mocks.mirrorUpFast,
  pickMatchedRepo: mocks.pickMatchedRepo,
}))

vi.mock('../src/local-repo.js', () => ({ getBranchName: mocks.getBranchName }))

vi.mock('../src/remote-session.js', () => ({
  createManagerSessionTransfer: mocks.createManagerSessionTransfer,
}))

vi.mock('../src/warp.js', () => ({
  setPendingWarp: mocks.setPendingWarp,
  runPendingWarp: mocks.runPendingWarp,
}))

vi.mock('../src/repo-proxy.js', () => ({ warmRepoProxy: mocks.warmRepoProxy }))

vi.mock('../src/manager-api.js', () => ({
  ManagerApi: class {
    constructor(
      public readonly managerUrl: string,
      public readonly token: string,
    ) {}
    mirrorTargetPlan = mocks.mirrorTargetPlan
    mirrorEnsureTarget = vi.fn()
  },
  ManagerApiError: class ManagerApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message)
    }
  },
  isManagerRouteMissing: vi.fn(() => false),
}))

const noFeatures = { remote: undefined, goals: undefined }

const matched = { repoId: 1, name: 'repo', projectId: 'proj_1', branch: 'main' }
const repos = [
  {
    repoId: 1,
    name: 'repo',
    directory: '/workspace/repos/repo',
    branch: 'main',
    cloneStatus: 'ready',
    extra: { repoId: 1, localPath: 'repo', fullPath: '/workspace/repos/repo' },
  },
]

function makeTransfer(): SessionTransferData {
  return {
    info: {
      id: 'ses_a',
      projectID: 'proj_1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: '/Users/x/repo' },
    },
    messages: [],
  } as unknown as SessionTransferData
}

function createFakeContext(session: { location: { directory: string }; parentID?: string } = { location: { directory: '/Users/x/repo' } }) {
  const exportMock = vi.fn()
  const confirm = vi.fn()
  const select = vi.fn()
  const toast = vi.fn()
  const layer = vi.fn()
  const dispatch = vi.fn()
  const slot = vi.fn(() => () => undefined)

  const context = {
    ui: {
      router: { current: () => ({ type: 'session', sessionID: 'ses_a' }) },
      toast: { show: toast },
      dialog: { confirm, select },
      slot,
    },
    data: {
      session: { get: () => session },
    },
    keymap: { layer, dispatch },
    client: { session: { export: exportMock } },
  } as unknown as Context

  return { context, exportMock, confirm, select, toast, layer, dispatch, slot }
}

function renderAppSlot(fake: ReturnType<typeof createFakeContext>) {
  const claim = fake.slot.mock.calls.map((call) => (call as unknown[])[0] as { append?: string; render: () => unknown }).find((c) => c.append === 'app')!
  claim.render()
}

function stubTransfer(options: { importError?: Error; reminderError?: Error; onManager?: string[]; existsError?: Error } = {}) {
  const sessionExists = vi.fn(async (sessionID: string) => {
    if (options.existsError) throw options.existsError
    return (options.onManager ?? []).includes(sessionID)
  })
  const importSession = vi.fn(async () => {
    mocks.calls.push('import')
    if (options.importError) throw options.importError
    return { sessionID: 'ses_a' }
  })
  const addReminder = vi.fn(async () => {
    mocks.calls.push('synthetic')
    if (options.reminderError) throw options.reminderError
  })
  mocks.createManagerSessionTransfer.mockReturnValue({ sessionExists, importSession, addReminder })
  return { sessionExists, importSession, addReminder }
}

function configureMove(fake: ReturnType<typeof createFakeContext>) {
  mocks.readState.mockReturnValue({ managerUrl: 'https://manager.example' })
  mocks.getToken.mockResolvedValue('tok')
  mocks.warmRepoProxy.mockResolvedValue(undefined)
  mocks.fetchRepos.mockResolvedValue(repos)
  mocks.toRemoteRepoSummaries.mockImplementation((r: unknown) => r)
  mocks.prepareMirror.mockResolvedValue({ repoRoot: '/Users/x/repo', localProjectId: 'proj_1', matched: [matched] })
  mocks.getBranchName.mockReturnValue('main')
  mocks.pickMatchedRepo.mockReturnValue(matched)
  mocks.mirrorTargetPlan.mockResolvedValue({
    kind: 'in-place',
    repoId: 1,
    fullPath: '/workspace/repos/repo',
    localPath: '/workspace/repos/repo',
    branch: 'main',
    currentBranch: null,
  })
  mocks.checkPushDivergence.mockResolvedValue({
    serverHead: null,
    serverBranch: 'main',
    serverDirty: false,
    diverged: false,
    lostCommits: 0,
  })
  mocks.describePushDivergence.mockReturnValue([])
  mocks.mirrorUpFast.mockResolvedValue({
    repoId: 1,
    fullPath: '/workspace/repos/repo',
    branch: 'main',
    head: null,
    created: false,
  })
  fake.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
}

async function invokeMove(fake: ReturnType<typeof createFakeContext>) {
  await setupOcm(fake.context, vi.fn(), noFeatures)
  renderAppSlot(fake)
  const factory = fake.layer.mock.calls[0]![0] as () => { commands: { id: string; run: () => Promise<void> }[] }
  const command = factory().commands.find((entry) => entry.id === 'ocm.session.move')!
  await command.run()
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.calls.length = 0
})

describe('setupOcm', () => {
  it('registers commands from the app slot so the host keymap provider is mounted', async () => {
    const fake = createFakeContext()

    await setupOcm(fake.context, vi.fn(), noFeatures)

    expect(fake.layer).not.toHaveBeenCalled()
    expect(fake.slot).toHaveBeenCalledWith(expect.objectContaining({ append: 'app' }))

    renderAppSlot(fake)

    expect(fake.layer).toHaveBeenCalledTimes(1)
    const factory = fake.layer.mock.calls[0]![0] as () => { mode?: string }
    expect(factory().mode).toBe('global')
  })

  it('exposes the goal slash command', async () => {
    const fake = createFakeContext()

    await setupOcm(fake.context, vi.fn(), noFeatures)
    renderAppSlot(fake)

    const factory = fake.layer.mock.calls[0]![0] as () => {
      commands: { id: string; slash?: { name: string; arguments?: true } }[]
    }
    const goal = factory().commands.find((entry) => entry.id === 'ocm.goal')
    expect(goal?.slash).toEqual({ name: 'goal', arguments: true })
  })

  it('exposes the multi-run slash command', async () => {
    const fake = createFakeContext()

    await setupOcm(fake.context, vi.fn(), noFeatures)
    renderAppSlot(fake)

    const factory = fake.layer.mock.calls[0]![0] as () => {
      commands: { id: string; slash?: { name: string; arguments?: true } }[]
    }
    const multiRun = factory().commands.find((entry) => entry.id === 'ocm.multirun')
    expect(multiRun?.slash).toEqual({ name: 'multirun', arguments: true })
  })
})

describe('ocm.session.move command', () => {
  it('exports, imports the rewritten transfer, then sends the synthetic reminder', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession, addReminder } = stubTransfer()
    fake.exportMock.mockImplementation(async () => {
      mocks.calls.push('export')
      return makeTransfer()
    })

    await invokeMove(fake)

    expect(mocks.calls).toEqual(['export', 'import', 'synthetic'])
    expect(fake.exportMock).toHaveBeenCalledWith({ sessionID: 'ses_a' })
    expect(importSession).toHaveBeenCalledWith(
      '/workspace/repos/repo',
      expect.objectContaining({ info: expect.objectContaining({ location: { directory: '/workspace/repos/repo' } }) }),
    )
    expect(addReminder).toHaveBeenCalledWith('ses_a', moveReminderText('/workspace/repos/repo'))
    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('does not import or remind when export fails', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession, addReminder } = stubTransfer()
    fake.exportMock.mockRejectedValue(new Error('export failed'))

    await invokeMove(fake)

    expect(mocks.calls).toEqual([])
    expect(importSession).not.toHaveBeenCalled()
    expect(addReminder).not.toHaveBeenCalled()
    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.confirm).toHaveBeenCalledTimes(1)
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('does not remind when import fails', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { addReminder } = stubTransfer({ importError: new Error('import diverged') })
    fake.exportMock.mockImplementation(async () => {
      mocks.calls.push('export')
      return makeTransfer()
    })

    await invokeMove(fake)

    expect(mocks.calls).toEqual(['export', 'import'])
    expect(addReminder).not.toHaveBeenCalled()
    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('keeps the move successful when the synthetic reminder fails', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { addReminder } = stubTransfer({ reminderError: new Error('synthetic failed') })
    fake.exportMock.mockImplementation(async () => {
      mocks.calls.push('export')
      return makeTransfer()
    })

    await invokeMove(fake)

    expect(addReminder).toHaveBeenCalledTimes(1)
    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  function expectNothingPushed(fake: ReturnType<typeof createFakeContext>, importSession: ReturnType<typeof vi.fn>) {
    expect(mocks.mirrorTargetPlan).not.toHaveBeenCalled()
    expect(fake.confirm).not.toHaveBeenCalled()
    expect(mocks.mirrorUpFast).not.toHaveBeenCalled()
    expect(fake.exportMock).not.toHaveBeenCalled()
    expect(importSession).not.toHaveBeenCalled()
  }

  it('refuses to push when the session is already on the Manager', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { sessionExists, importSession } = stubTransfer({ onManager: ['ses_a'] })

    await invokeMove(fake)

    expect(sessionExists).toHaveBeenCalledWith('ses_a')
    expectNothingPushed(fake, importSession)
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: expect.stringContaining('already on the Manager') }))
  })

  it('refuses to push a subagent session whose parent is not on the Manager', async () => {
    const fake = createFakeContext({ location: { directory: '/Users/x/repo' }, parentID: 'ses_parent' })
    configureMove(fake)
    const { sessionExists, importSession } = stubTransfer()

    await invokeMove(fake)

    expect(sessionExists).toHaveBeenCalledWith('ses_parent')
    expectNothingPushed(fake, importSession)
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: expect.stringContaining('Move the parent session first') }))
  })

  it('moves a subagent session once its parent is on the Manager', async () => {
    const fake = createFakeContext({ location: { directory: '/Users/x/repo' }, parentID: 'ses_parent' })
    configureMove(fake)
    const { importSession } = stubTransfer({ onManager: ['ses_parent'] })
    fake.exportMock.mockResolvedValue(makeTransfer())

    await invokeMove(fake)

    expect(mocks.mirrorUpFast).toHaveBeenCalledTimes(1)
    expect(importSession).toHaveBeenCalledTimes(1)
  })

  it('refuses to push when the Manager session check fails', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer({ existsError: new Error('proxy unreachable') })

    await invokeMove(fake)

    expectNothingPushed(fake, importSession)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'proxy unreachable' })
  })

  it('stops before pushing when the Manager lacks the repo proxy route', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer()
    const tooOld = 'OpenCode Manager at https://manager.example is too old for ocm 0.3.0; upgrade the Manager to >= 0.19.0'
    mocks.warmRepoProxy.mockRejectedValue(new Error(tooOld))

    await invokeMove(fake)

    expect(mocks.warmRepoProxy).toHaveBeenCalledWith('https://manager.example', 'tok', 1)
    expect(fake.confirm).not.toHaveBeenCalled()
    expect(mocks.mirrorUpFast).not.toHaveBeenCalled()
    expect(fake.exportMock).not.toHaveBeenCalled()
    expect(importSession).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: tooOld })
  })
})
