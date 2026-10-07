import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@opencode/plugin/tui/context'
import { runOcmSwitch } from '../src/tui-ocm.js'
import type { ManagerRepo } from '../src/manager-repos.js'
import type { RemoteContext } from '../src/remote-context.js'

const mocks = vi.hoisted(() => ({
  resolveManagerAuth: vi.fn(),
  fetchRepos: vi.fn(),
  resolveOpenCodeProjectId: vi.fn(),
  warmRepoProxy: vi.fn(),
  readState: vi.fn(),
  writeState: vi.fn(),
  setPendingWarp: vi.fn(),
}))

vi.mock('../src/manager-auth.js', () => ({ resolveManagerAuth: mocks.resolveManagerAuth }))
vi.mock('../src/manager-repos.js', () => ({ fetchRepos: mocks.fetchRepos }))
vi.mock('@opencode-manager/shared/project-id', () => ({ resolveOpenCodeProjectId: mocks.resolveOpenCodeProjectId }))
vi.mock('../src/repo-proxy.js', () => ({ warmRepoProxy: mocks.warmRepoProxy }))
vi.mock('../src/state.js', () => ({ readState: mocks.readState, writeState: mocks.writeState }))
vi.mock('../src/warp.js', () => ({ setPendingWarp: mocks.setPendingWarp }))

const MANAGER_URL = 'https://manager.example'

function repo(overrides: Partial<ManagerRepo> = {}): ManagerRepo {
  return {
    repoId: 1,
    name: 'oc-manager',
    branch: 'main',
    cloneStatus: 'ready',
    directory: '/srv/repos/oc-manager',
    projectId: 'proj_a',
    isWorktree: false,
    extra: { repoId: 1, localPath: 'oc-manager', fullPath: '/srv/repos/oc-manager' },
    ...overrides,
  }
}

function createFakeContext(route: { type: string; sessionID?: string } = { type: 'home' }) {
  const toast = vi.fn()
  const confirm = vi.fn()
  const select = vi.fn()
  const dispatch = vi.fn()
  const context = {
    ui: {
      toast: { show: toast },
      dialog: { confirm, select },
      router: { current: () => route },
    },
    data: { session: { get: () => ({ location: { directory: '/work/session-dir' } }) } },
    keymap: { dispatch },
  } as unknown as Context
  return { context, toast, confirm, select, dispatch }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolveManagerAuth.mockResolvedValue({ ok: true, managerUrl: MANAGER_URL, token: 'tok' })
  mocks.readState.mockReturnValue({ managerUrl: MANAGER_URL })
  mocks.resolveOpenCodeProjectId.mockResolvedValue('proj_a')
})

describe('runOcmSwitch from a local TUI', () => {
  it('confirms and attaches to the single Manager repo matching this directory', async () => {
    const fake = createFakeContext()
    const match = repo()
    mocks.fetchRepos.mockResolvedValue([match, repo({ repoId: 2, name: 'other', projectId: 'proj_b' })])
    fake.confirm.mockResolvedValue(true)

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/work/oc-manager' })

    expect(mocks.resolveManagerAuth).toHaveBeenCalledWith(undefined)
    expect(mocks.resolveOpenCodeProjectId).toHaveBeenCalledWith('/work/oc-manager')
    expect(fake.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Switch to OpenCode Manager', message: expect.stringContaining('attach to oc-manager on manager.example') }),
    )
    expect(mocks.warmRepoProxy).toHaveBeenCalledWith(MANAGER_URL, 'tok', 1)
    expect(mocks.writeState).toHaveBeenCalledWith({
      managerUrl: MANAGER_URL,
      lastRepoId: 1,
      lastRepoName: 'oc-manager',
      lastRepoDir: '/srv/repos/oc-manager',
      lastRepoBranch: 'main',
    })
    expect(mocks.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: { managerUrl: MANAGER_URL, token: 'tok', repoId: 1, repoName: 'oc-manager' },
    })
    expect(fake.dispatch).toHaveBeenCalledWith('app.exit')
    expect(mocks.warmRepoProxy.mock.invocationCallOrder[0]).toBeLessThan(fake.dispatch.mock.invocationCallOrder[0]!)
  })

  it('stays put when the switch is declined', async () => {
    const fake = createFakeContext()
    mocks.fetchRepos.mockResolvedValue([repo()])
    fake.confirm.mockResolvedValue(false)

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/work/oc-manager' })

    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('uses the current session directory to find the matching repo', async () => {
    const fake = createFakeContext({ type: 'session', sessionID: 'ses_a' })
    mocks.fetchRepos.mockResolvedValue([repo()])

    await runOcmSwitch(fake.context, { remote: undefined })

    expect(mocks.resolveOpenCodeProjectId).toHaveBeenCalledWith('/work/session-dir')
  })

  it('offers a picker with matching repos first when several match, skipping repos that are not ready', async () => {
    const fake = createFakeContext()
    const main = repo()
    const worktree = repo({ repoId: 3, name: 'oc-manager-feature', branch: 'feature', isWorktree: true })
    const other = repo({ repoId: 2, name: 'other', projectId: 'proj_b', branch: null })
    mocks.fetchRepos.mockResolvedValue([other, main, worktree, repo({ repoId: 4, name: 'cloning', cloneStatus: 'cloning' })])
    fake.select.mockResolvedValue({ kind: 'repo', repo: worktree })

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/work/oc-manager' })

    const options = fake.select.mock.calls[0]![0].options as { title: string; description?: string; category: string }[]
    expect(options.map((option) => [option.title, option.category, option.description])).toEqual([
      ['oc-manager', 'Matches this directory', 'main'],
      ['oc-manager-feature', 'Matches this directory', 'worktree · feature'],
      ['other', 'Manager repos', undefined],
    ])
    expect(mocks.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: { managerUrl: MANAGER_URL, token: 'tok', repoId: 3, repoName: 'oc-manager-feature' },
    })
  })

  it('offers every ready repo when nothing matches, and does nothing when dismissed', async () => {
    const fake = createFakeContext()
    mocks.resolveOpenCodeProjectId.mockResolvedValue(null)
    mocks.fetchRepos.mockResolvedValue([repo(), repo({ repoId: 2, name: 'other' })])
    fake.select.mockResolvedValue(undefined)

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/tmp' })

    const options = fake.select.mock.calls[0]![0].options as { category: string }[]
    expect(options.map((option) => option.category)).toEqual(['Manager repos', 'Manager repos'])
    expect(mocks.warmRepoProxy).not.toHaveBeenCalled()
    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
  })

  it('reports a Manager without ready repos', async () => {
    const fake = createFakeContext()
    mocks.fetchRepos.mockResolvedValue([repo({ cloneStatus: 'error' })])

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/work/oc-manager' })

    expect(fake.toast).toHaveBeenCalledWith({
      variant: 'error',
      message: 'The Manager has no ready repos. Run `ocm push --create` first.',
    })
    expect(fake.select).not.toHaveBeenCalled()
  })
})

describe('runOcmSwitch from an attached TUI', () => {
  const remote: RemoteContext = { managerUrl: MANAGER_URL, managerHost: 'manager.example', repoName: 'oc-manager', repoId: 1 }

  it('offers local opencode first and marks the current repo as unavailable', async () => {
    const fake = createFakeContext()
    mocks.fetchRepos.mockResolvedValue([repo(), repo({ repoId: 2, name: 'other' })])
    fake.select.mockResolvedValue({ kind: 'local' })

    await runOcmSwitch(fake.context, { remote })

    expect(mocks.resolveManagerAuth).toHaveBeenCalledWith(MANAGER_URL)
    expect(mocks.resolveOpenCodeProjectId).not.toHaveBeenCalled()
    const options = fake.select.mock.calls[0]![0].options as { title: string; disabled?: boolean; description?: string }[]
    expect(options.map((option) => [option.title, option.disabled ?? false])).toEqual([
      ['Local opencode', false],
      ['oc-manager', true],
      ['other', false],
    ])
    expect(options[1]!.description).toBe('Current')
    expect(mocks.setPendingWarp).toHaveBeenCalledWith({ kind: 'local' })
    expect(mocks.warmRepoProxy).not.toHaveBeenCalled()
    expect(fake.dispatch).toHaveBeenCalledWith('app.exit')
  })

  it('switches to another Manager repo', async () => {
    const fake = createFakeContext()
    const other = repo({ repoId: 2, name: 'other' })
    mocks.fetchRepos.mockResolvedValue([repo(), other])
    fake.select.mockResolvedValue({ kind: 'repo', repo: other })

    await runOcmSwitch(fake.context, { remote })

    expect(mocks.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: { managerUrl: MANAGER_URL, token: 'tok', repoId: 2, repoName: 'other' },
    })
  })
})

describe('runOcmSwitch failures', () => {
  it('reports an auth failure without contacting the Manager', async () => {
    const fake = createFakeContext()
    mocks.resolveManagerAuth.mockResolvedValue({ ok: false, message: 'No manager configured. Run `ocm login <url>` first.' })

    await runOcmSwitch(fake.context, { remote: undefined })

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'No manager configured. Run `ocm login <url>` first.' })
    expect(mocks.fetchRepos).not.toHaveBeenCalled()
  })

  it('reports a Manager request failure and does not exit', async () => {
    const fake = createFakeContext()
    mocks.fetchRepos.mockRejectedValue(new Error('manager responded 502 Bad Gateway'))

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/work/oc-manager' })

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'manager responded 502 Bad Gateway' })
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('does not exit when the repo proxy cannot be warmed', async () => {
    const fake = createFakeContext()
    mocks.fetchRepos.mockResolvedValue([repo()])
    fake.confirm.mockResolvedValue(true)
    mocks.warmRepoProxy.mockRejectedValue(new Error('Manager is older than ocm requires'))

    await runOcmSwitch(fake.context, { remote: undefined, cwd: '/work/oc-manager' })

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'Manager is older than ocm requires' })
    expect(mocks.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.dispatch).not.toHaveBeenCalled()
  })
})
