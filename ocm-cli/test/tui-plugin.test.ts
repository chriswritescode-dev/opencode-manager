import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import type { SessionInfo, SessionTransferData } from '@opencode-manager/shared/opencode'
import { setupOcm } from '../src/tui-plugin.js'
import type { OcmFeatures, OcmPluginDeps } from '../src/tui-plugin.js'
import { moveReminderText } from '../src/session-move.js'
import type { MoveDestination, RemoteRepoSummary } from '../src/mirror.js'
import type { ManagerSessionTransfer } from '../src/remote-session.js'
import type { ManagerRepo } from '../src/manager-repos.js'
import type { OcmTuiContext } from '../src/tui-context.js'
import type { PendingWarp } from '../src/warp.js'

const MANAGER_URL = 'https://manager.example'

const matched: RemoteRepoSummary = { repoId: 1, name: 'repo', projectId: 'proj_1', branch: 'main' }

const repo: ManagerRepo = {
  repoId: 1,
  name: 'repo',
  branch: 'main',
  cloneStatus: 'ready',
  directory: '/workspace/repos/repo',
  extra: { repoId: 1, localPath: 'repo', fullPath: '/workspace/repos/repo' },
}

const noFeatures: OcmFeatures = { remote: undefined, dialogs: { multiRunLaunch: vi.fn(), multiRuns: vi.fn() } }

function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const base: SessionInfo = {
    id: 'ses_a',
    projectID: 'proj_1',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    location: { directory: '/Users/x/repo' },
  }
  return { ...base, ...overrides }
}

function makeTransfer(): SessionTransferData {
  return {
    info: createSession(),
    messages: [],
  }
}

const inPlace: MoveDestination = { kind: 'in-place', directory: '/workspace/repos/repo', branch: 'main', reasons: [] }

const pushedInPlace = {
  repoId: 1,
  fullPath: '/workspace/repos/repo',
  branch: 'main',
  head: null,
  created: false,
}

function createFakeContext(session: SessionInfo = createSession()) {
  const exportSession = vi.fn<Context['client']['session']['export']>()
  const confirm = vi.fn<Context['ui']['dialog']['confirm']>()
  const select = vi.fn()
  const prompt = vi.fn<Context['ui']['dialog']['prompt']>()
  const toast = vi.fn<Context['ui']['toast']['show']>()
  const layer = vi.fn<Context['keymap']['layer']>()
  const dispatch = vi.fn<Context['keymap']['dispatch']>()
  const slot = vi.fn<Context['ui']['slot']>(() => () => undefined)

  const context: OcmTuiContext = {
    ui: {
      router: {
        current: () => ({ type: 'session', sessionID: session.id }),
        navigate: vi.fn(),
      },
      toast: { show: toast },
      dialog: { confirm, select, prompt },
      tabs: { enabled: () => false, open: () => true, focus: () => true },
      slot,
    },
    data: {
      session: { get: () => session },
      location: {
        model: { list: () => [], sync: async () => undefined },
        provider: { list: () => [], sync: async () => undefined },
      },
    },
    keymap: { layer, dispatch },
    client: { session: { export: exportSession } },
  }

  return { context, exportSession, confirm, select, toast, layer, dispatch, slot }
}

interface FixtureOptions {
  session?: SessionInfo
  branch?: string | null
  destination?: MoveDestination
  pushed?: {
    repoId: number
    fullPath: string
    branch: string | null
    head: string | null
    created: boolean
    worktreeSetup?: { status: 'none' } | { status: 'failed'; error: string }
  }
  onManager?: string[]
  existsError?: Error
  importError?: Error
  reminderError?: Error
  exportError?: Error
  proxyError?: Error
  confirmAnswers?: boolean[]
  deps?: Partial<OcmPluginDeps>
}

function createFixture(options: FixtureOptions = {}) {
  const fake = createFakeContext(options.session)
  const calls: string[] = []
  const onManager = options.onManager ?? []

  const transfer: ManagerSessionTransfer = {
    sessionExists: vi.fn<ManagerSessionTransfer['sessionExists']>(async (sessionID) => {
      if (options.existsError) throw options.existsError
      return onManager.includes(sessionID)
    }),
    importSession: vi.fn<ManagerSessionTransfer['importSession']>(async () => {
      calls.push('import')
      if (options.importError) throw options.importError
      return { sessionID: 'ses_a' }
    }),
    addReminder: vi.fn<ManagerSessionTransfer['addReminder']>(async (sessionID, text) => {
      calls.push('synthetic')
      if (options.reminderError) throw options.reminderError
      return { id: 'msg_synthetic', sessionID, time: { created: 1 }, type: 'synthetic', payload: { text }, delivery: 'queue' }
    }),
  }

  const managerApi = {
    mirrorCheckouts: vi.fn(async () => ({
      main: { directory: '/workspace/repos/repo', branch: 'main', head: null, dirty: false },
      worktrees: [],
      branchHead: null,
      branchCheckedOut: false,
      suffixedWorktreeBranch: 'main-ocm',
    })),
    mirrorCreateWorktree: vi.fn(),
    mirrorUploadBundle: vi.fn(),
    mirrorPatch: vi.fn(),
  }

  const deps: OcmPluginDeps = {
    readInstallNotice: vi.fn(() => null),
    resolveManagerAuth: vi.fn<OcmPluginDeps['resolveManagerAuth']>(async () => ({ ok: true, managerUrl: MANAGER_URL, token: 'tok' })),
    fetchRepos: vi.fn(async () => [repo]),
    toRemoteRepoSummaries: vi.fn(() => [matched]),
    prepareMirror: vi.fn(async () => ({ repoRoot: '/Users/x/repo', localProjectId: 'proj_1', matched: [matched] })),
    getBranchName: vi.fn(() => options.branch === undefined ? 'main' : options.branch),
    pickMatchedRepo: vi.fn(() => matched),
    warmRepoProxy: vi.fn(async () => {
      if (options.proxyError) throw options.proxyError
    }),
    createManagerSessionTransfer: vi.fn(() => transfer),
    createManagerApi: vi.fn(() => managerApi),
    chooseMoveDestination: vi.fn(() => options.destination ?? inPlace),
    mirrorUpFast: vi.fn(async () => options.pushed ?? pushedInPlace),
    setPendingWarp: vi.fn<(warp: PendingWarp) => void>(),
    runPendingWarp: vi.fn(),
    ...options.deps,
  }

  fake.exportSession.mockImplementation(async () => {
    calls.push('export')
    if (options.exportError) throw options.exportError
    return makeTransfer()
  })
  const answers = options.confirmAnswers ?? [true, false]
  for (const answer of answers) fake.confirm.mockResolvedValueOnce(answer)

  return { ...fake, deps, calls, transfer, managerApi }
}

type Fixture = ReturnType<typeof createFixture>

function renderAppSlot(fake: Fixture): void {
  const claim = fake.slot.mock.calls[0]![0]
  if (!('append' in claim) || claim.append !== 'app') throw new Error('expected an app slot claim')
  claim.render({})
}

async function invokeMove(fake: Fixture): Promise<void> {
  await setupOcm(fake.context, vi.fn(), noFeatures, fake.deps)
  renderAppSlot(fake)
  const factory = fake.layer.mock.calls[0]![0]
  const command = factory().commands?.find((entry) => entry.id === 'ocm.session.move')
  await command?.run()
}

function commandIds(fake: Fixture): (string | undefined)[] | undefined {
  renderAppSlot(fake)
  return fake.layer.mock.calls[0]![0]().commands?.map((entry) => entry.id)
}

describe('setupOcm', () => {
  it('registers commands from the app slot so the host keymap provider is mounted', async () => {
    const fake = createFixture()

    await setupOcm(fake.context, vi.fn(), noFeatures, fake.deps)

    expect(fake.layer).not.toHaveBeenCalled()
    expect(fake.slot).toHaveBeenCalledWith(expect.objectContaining({ append: 'app' }))

    renderAppSlot(fake)

    expect(fake.layer).toHaveBeenCalledTimes(1)
    expect(fake.layer.mock.calls[0]![0]().mode).toBe('global')
  })

  it('registers the move, switch and multi-run commands but no goal command', async () => {
    const fake = createFixture()
    await setupOcm(fake.context, vi.fn(), noFeatures, fake.deps)

    expect(commandIds(fake)).toEqual(['ocm.session.move', 'ocm.switch', 'ocm.multirun'])
  })

  it('exposes the multi-run and server switch slash commands', async () => {
    const fake = createFixture()
    await setupOcm(fake.context, vi.fn(), noFeatures, fake.deps)
    renderAppSlot(fake)

    const commands = fake.layer.mock.calls[0]![0]().commands ?? []
    expect(commands.find((entry) => entry.id === 'ocm.multirun')?.slash).toEqual({ name: 'ocm-multirun', arguments: true })
    expect(commands.find((entry) => entry.id === 'ocm.switch')?.slash).toEqual({ name: 'ocm' })
  })

  it('shows the install notice once when one is pending', async () => {
    const fake = createFixture({
      deps: { readInstallNotice: vi.fn(() => ({ link: '/home/me/.local/bin/ocm', binDir: '/home/me/.local/bin', pathMissing: true })) },
    })

    await setupOcm(fake.context, vi.fn(), noFeatures, fake.deps)

    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success',
      message: expect.stringContaining('/home/me/.local/bin/ocm'),
    }))
  })

  it('runs the deferred warp when the returned cleanup is called', async () => {
    const fake = createFixture()

    const cleanup = await setupOcm(fake.context, vi.fn(), noFeatures, fake.deps)
    cleanup()

    expect(fake.deps.runPendingWarp).toHaveBeenCalledOnce()
  })
})

describe('ocm.session.move command', () => {
  it('exports, imports the rewritten transfer, then sends the synthetic reminder', async () => {
    const fake = createFixture({ confirmAnswers: [true, false] })

    await invokeMove(fake)

    expect(fake.calls).toEqual(['export', 'import', 'synthetic'])
    expect(fake.exportSession).toHaveBeenCalledWith({ sessionID: 'ses_a' })
    expect(fake.transfer.importSession).toHaveBeenCalledWith(
      '/workspace/repos/repo',
      expect.objectContaining({ info: expect.objectContaining({ location: { directory: '/workspace/repos/repo' } }) }),
    )
    expect(fake.transfer.addReminder).toHaveBeenCalledWith('ses_a', moveReminderText('/workspace/repos/repo'))
    expect(fake.deps.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('does not import or remind when export fails', async () => {
    const fake = createFixture({ exportError: new Error('export failed') })

    await invokeMove(fake)

    expect(fake.calls).toEqual(['export'])
    expect(fake.transfer.importSession).not.toHaveBeenCalled()
    expect(fake.transfer.addReminder).not.toHaveBeenCalled()
    expect(fake.deps.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.confirm).toHaveBeenCalledTimes(1)
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('does not remind when import fails', async () => {
    const fake = createFixture({ importError: new Error('import diverged') })

    await invokeMove(fake)

    expect(fake.calls).toEqual(['export', 'import'])
    expect(fake.transfer.addReminder).not.toHaveBeenCalled()
    expect(fake.deps.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('keeps the move successful when the synthetic reminder fails', async () => {
    const fake = createFixture({ reminderError: new Error('synthetic failed') })

    await invokeMove(fake)

    expect(fake.transfer.addReminder).toHaveBeenCalledTimes(1)
    expect(fake.deps.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  it('attaches to the moved session when the user confirms the warp', async () => {
    const fake = createFixture({ confirmAnswers: [true, true] })

    await invokeMove(fake)

    expect(fake.deps.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: expect.objectContaining({ repoId: 1, sessionID: 'ses_a', managerUrl: MANAGER_URL }),
    })
    expect(fake.dispatch).toHaveBeenCalledWith('app.exit')
  })

  function expectNothingPushed(fake: Fixture) {
    expect(fake.managerApi.mirrorCheckouts).not.toHaveBeenCalled()
    expect(fake.confirm).not.toHaveBeenCalled()
    expect(fake.deps.mirrorUpFast).not.toHaveBeenCalled()
    expect(fake.exportSession).not.toHaveBeenCalled()
    expect(fake.transfer.importSession).not.toHaveBeenCalled()
  }

  it('refuses to push when the session is already on the Manager', async () => {
    const fake = createFixture({ onManager: ['ses_a'] })

    await invokeMove(fake)

    expect(fake.transfer.sessionExists).toHaveBeenCalledWith('ses_a')
    expectNothingPushed(fake)
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: expect.stringContaining('already on the Manager') }))
  })

  it('refuses to push a subagent session whose parent is not on the Manager', async () => {
    const fake = createFixture({ session: createSession({ parentID: 'ses_parent' }) })

    await invokeMove(fake)

    expect(fake.transfer.sessionExists).toHaveBeenCalledWith('ses_parent')
    expectNothingPushed(fake)
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: expect.stringContaining('Move the parent session first') }))
  })

  it('moves a subagent session once its parent is on the Manager', async () => {
    const fake = createFixture({ session: createSession({ parentID: 'ses_parent' }), onManager: ['ses_parent'] })

    await invokeMove(fake)

    expect(fake.deps.mirrorUpFast).toHaveBeenCalledTimes(1)
    expect(fake.transfer.importSession).toHaveBeenCalledTimes(1)
  })

  it('refuses to push when the Manager session check fails', async () => {
    const fake = createFixture({ existsError: new Error('proxy unreachable') })

    await invokeMove(fake)

    expectNothingPushed(fake)
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'proxy unreachable' })
  })

  it('stops before pushing when the Manager lacks the repo proxy route', async () => {
    const tooOld = 'OpenCode Manager at https://manager.example is too old for ocm 0.3.0; upgrade the Manager to >= 0.19.0'
    const fake = createFixture({ proxyError: new Error(tooOld) })

    await invokeMove(fake)

    expect(fake.deps.warmRepoProxy).toHaveBeenCalledWith(MANAGER_URL, 'tok', 1)
    expect(fake.confirm).not.toHaveBeenCalled()
    expect(fake.deps.mirrorUpFast).not.toHaveBeenCalled()
    expect(fake.exportSession).not.toHaveBeenCalled()
    expect(fake.transfer.importSession).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: tooOld })
  })

  it('refuses to move from a detached HEAD before pushing anything', async () => {
    const fake = createFixture({ branch: null })

    await invokeMove(fake)

    expect(fake.managerApi.mirrorCheckouts).not.toHaveBeenCalled()
    expect(fake.deps.mirrorUpFast).not.toHaveBeenCalled()
    expect(fake.exportSession).not.toHaveBeenCalled()
    expect(fake.transfer.importSession).not.toHaveBeenCalled()
    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: expect.stringContaining('detached HEAD') }))
  })

  it('pushes in place with the strict current-branch guard when the main checkout is safe', async () => {
    const fake = createFixture()

    await invokeMove(fake)

    expect(fake.managerApi.mirrorCheckouts).toHaveBeenCalledWith(1, 'main')
    expect(fake.deps.mirrorUpFast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ force: true, requireCurrentBranch: true }),
    )
    const pushOpts = vi.mocked(fake.deps.mirrorUpFast).mock.calls[0]![1]
    expect(pushOpts.directory).toBeUndefined()
    expect(pushOpts.targetBranch).toBeUndefined()
    expect(fake.transfer.importSession).toHaveBeenCalledWith('/workspace/repos/repo', expect.anything())
  })

  it('pushes into an existing suffixed worktree directory with the strict current-branch guard', async () => {
    const fake = createFixture({
      destination: { kind: 'existing-worktree', directory: '/workspace/repos/repo-feature-ocm', branch: 'feature-ocm', reasons: [] },
      pushed: { repoId: 1, fullPath: '/workspace/repos/repo-feature-ocm', branch: 'feature-ocm', head: null, created: false },
    })

    await invokeMove(fake)

    expect(fake.deps.mirrorUpFast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        force: true,
        requireCurrentBranch: true,
        directory: '/workspace/repos/repo-feature-ocm',
        targetBranch: 'feature-ocm',
      }),
    )
    expect(fake.transfer.importSession).toHaveBeenCalledWith('/workspace/repos/repo-feature-ocm', expect.anything())
  })

  it('creates a new worktree through the fast push when no safe checkout exists', async () => {
    const fake = createFixture({
      destination: { kind: 'new-worktree', directory: null, branch: 'feature-ocm', reasons: ['the server checkout is on main'] },
      pushed: {
        repoId: 1,
        fullPath: '/workspace/repos/repo-feature-ocm',
        branch: 'feature-ocm',
        head: null,
        created: true,
        worktreeSetup: { status: 'none' },
      },
    })

    await invokeMove(fake)

    expect(fake.deps.mirrorUpFast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        force: true,
        createWorktree: { targetBranch: 'feature-ocm' },
      }),
    )
    expect(fake.transfer.importSession).toHaveBeenCalledWith('/workspace/repos/repo-feature-ocm', expect.anything())
  })

  it('warns without aborting when worktree setup fails', async () => {
    const fake = createFixture({
      destination: { kind: 'new-worktree', directory: null, branch: 'feature-ocm', reasons: [] },
      pushed: {
        repoId: 1,
        fullPath: '/workspace/repos/repo-feature-ocm',
        branch: 'feature-ocm',
        head: null,
        created: true,
        worktreeSetup: { status: 'failed', error: 'setup script exploded' },
      },
    })

    await invokeMove(fake)

    expect(fake.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning',
      message: expect.stringContaining('setup script exploded'),
    }))
    expect(fake.transfer.importSession).toHaveBeenCalledWith('/workspace/repos/repo-feature-ocm', expect.anything())
  })
})
