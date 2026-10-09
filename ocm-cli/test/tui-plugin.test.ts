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
  chooseMoveDestination: vi.fn(),
  mirrorUpFast: vi.fn(),
  pickMatchedRepo: vi.fn(),
  getBranchName: vi.fn(),
  createManagerSessionTransfer: vi.fn(),
  setPendingWarp: vi.fn(),
  runPendingWarp: vi.fn(),
  mirrorCheckouts: vi.fn(),
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
  chooseMoveDestination: mocks.chooseMoveDestination,
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
    mirrorCheckouts = mocks.mirrorCheckouts
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

const noFeatures = { remote: undefined, goals: undefined, dialogs: { goal: vi.fn(), multiRunLaunch: vi.fn(), multiRuns: vi.fn() } }

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
  mocks.mirrorCheckouts.mockResolvedValue({
    main: { directory: '/workspace/repos/repo', branch: 'main', head: null, dirty: false },
    worktrees: [],
    branchHead: null,
    branchCheckedOut: false,
    suffixedWorktreeBranch: 'main-ocm',
  })
  mocks.chooseMoveDestination.mockReturnValue({
    kind: 'in-place',
    directory: '/workspace/repos/repo',
    branch: 'main',
    reasons: [],
  })
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
    expect(goal?.slash).toEqual({ name: 'ocm-goal', arguments: true })
  })

  it('exposes the multi-run slash command', async () => {
    const fake = createFakeContext()

    await setupOcm(fake.context, vi.fn(), noFeatures)
    renderAppSlot(fake)

    const factory = fake.layer.mock.calls[0]![0] as () => {
      commands: { id: string; slash?: { name: string; arguments?: true } }[]
    }
    const multiRun = factory().commands.find((entry) => entry.id === 'ocm.multirun')
    expect(multiRun?.slash).toEqual({ name: 'ocm-multirun', arguments: true })
  })

  it('exposes the server switch slash command', async () => {
    const fake = createFakeContext()

    await setupOcm(fake.context, vi.fn(), noFeatures)
    renderAppSlot(fake)

    const factory = fake.layer.mock.calls[0]![0] as () => {
      commands: { id: string; slash?: { name: string; arguments?: true } }[]
    }
    const command = factory().commands.find((entry) => entry.id === 'ocm.switch')
    expect(command?.slash).toEqual({ name: 'ocm' })
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
    expect(mocks.mirrorCheckouts).not.toHaveBeenCalled()
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

  it('refuses to move from a detached HEAD before pushing anything', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer()
    mocks.getBranchName.mockReturnValue(null)

    await invokeMove(fake)

    expect(mocks.mirrorCheckouts).not.toHaveBeenCalled()
    expect(mocks.mirrorUpFast).not.toHaveBeenCalled()
    expect(fake.exportMock).not.toHaveBeenCalled()
    expect(importSession).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: expect.stringContaining('detached HEAD') }))
  })

  it('pushes in place with the strict current-branch guard when the main checkout is safe', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer()
    fake.exportMock.mockResolvedValue(makeTransfer())

    await invokeMove(fake)

    expect(mocks.mirrorCheckouts).toHaveBeenCalledWith(1, 'main')
    expect(mocks.mirrorUpFast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ force: true, requireCurrentBranch: true }),
    )
    const pushOpts = mocks.mirrorUpFast.mock.calls[0]![1] as { directory?: string; targetBranch?: string }
    expect(pushOpts.directory).toBeUndefined()
    expect(pushOpts.targetBranch).toBeUndefined()
    expect(importSession).toHaveBeenCalledWith('/workspace/repos/repo', expect.anything())
  })

  it('pushes into an existing suffixed worktree directory with the strict current-branch guard', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer()
    fake.exportMock.mockResolvedValue(makeTransfer())
    mocks.chooseMoveDestination.mockReturnValue({
      kind: 'existing-worktree',
      directory: '/workspace/repos/repo-feature-ocm',
      branch: 'feature-ocm',
      reasons: [],
    })
    mocks.mirrorUpFast.mockResolvedValue({
      repoId: 1,
      fullPath: '/workspace/repos/repo-feature-ocm',
      branch: 'feature-ocm',
      head: null,
      created: false,
    })

    await invokeMove(fake)

    expect(mocks.mirrorUpFast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        force: true,
        requireCurrentBranch: true,
        directory: '/workspace/repos/repo-feature-ocm',
        targetBranch: 'feature-ocm',
      }),
    )
    expect(importSession).toHaveBeenCalledWith('/workspace/repos/repo-feature-ocm', expect.anything())
  })

  it('creates a new worktree through the fast push when no safe checkout exists', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer()
    fake.exportMock.mockResolvedValue(makeTransfer())
    mocks.chooseMoveDestination.mockReturnValue({
      kind: 'new-worktree',
      directory: null,
      branch: 'feature-ocm',
      reasons: ['the server checkout is on main'],
    })
    mocks.mirrorUpFast.mockResolvedValue({
      repoId: 1,
      fullPath: '/workspace/repos/repo-feature-ocm',
      branch: 'feature-ocm',
      head: null,
      created: true,
      worktreeSetup: { status: 'none' },
    })

    await invokeMove(fake)

    expect(mocks.mirrorUpFast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        force: true,
        createWorktree: { targetBranch: 'feature-ocm' },
      }),
    )
    expect(importSession).toHaveBeenCalledWith('/workspace/repos/repo-feature-ocm', expect.anything())
  })

  it('warns without aborting when worktree setup fails', async () => {
    const fake = createFakeContext()
    configureMove(fake)
    const { importSession } = stubTransfer()
    fake.exportMock.mockResolvedValue(makeTransfer())
    mocks.chooseMoveDestination.mockReturnValue({
      kind: 'new-worktree',
      directory: null,
      branch: 'feature-ocm',
      reasons: [],
    })
    mocks.mirrorUpFast.mockResolvedValue({
      repoId: 1,
      fullPath: '/workspace/repos/repo-feature-ocm',
      branch: 'feature-ocm',
      head: null,
      created: true,
      worktreeSetup: { status: 'failed', error: 'setup script exploded' },
    })

    await invokeMove(fake)

    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning',
      message: expect.stringContaining('setup script exploded'),
    }))
    expect(importSession).toHaveBeenCalledWith('/workspace/repos/repo-feature-ocm', expect.anything())
  })
})
