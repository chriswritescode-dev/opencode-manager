import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type { Context } from '@opencode/plugin/tui/context'
import { runOcmSwitch } from '../src/tui-ocm.js'
import type { OcmSwitchDeps, OcmSwitchRuntime } from '../src/tui-ocm.js'
import type { ManagerRepo } from '../src/manager-repos.js'
import type { RemoteContext } from '../src/remote-context.js'
import type { OcmTuiContext } from '../src/tui-context.js'

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

const SelectRequestSchema = z.object({
  title: z.string(),
  options: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    disabled: z.boolean().optional(),
  }).loose()),
})

function createFakeContext(route: { type: string; sessionID?: string } = { type: 'home' }) {
  const toast = vi.fn<Context['ui']['toast']['show']>()
  const confirm = vi.fn<Context['ui']['dialog']['confirm']>()
  const select = vi.fn()
  const dispatch = vi.fn<Context['keymap']['dispatch']>()
  const context: OcmTuiContext = {
    ui: {
      toast: { show: toast },
      dialog: { confirm, select, prompt: vi.fn() },
      router: { current: () => (route.type === 'session' ? { type: 'session', sessionID: route.sessionID ?? 'ses_a' } : { type: 'home' }), navigate: vi.fn() },
      tabs: { enabled: () => false, open: () => true, focus: () => true },
      slot: vi.fn(() => () => undefined),
    },
    data: { session: { get: () => undefined }, location: { model: { list: () => [], sync: async () => undefined }, provider: { list: () => [], sync: async () => undefined } } },
    keymap: { layer: vi.fn(), dispatch },
    client: { session: { export: vi.fn() } },
  }
  return { context, toast, confirm, select, dispatch }
}

function offeredOptions(fake: ReturnType<typeof createFakeContext>) {
  return SelectRequestSchema.parse(fake.select.mock.calls[0]?.[0]).options
}

function createRuntime(): OcmSwitchRuntime {
  return {
    resolveManagerAuth: vi.fn<OcmSwitchRuntime['resolveManagerAuth']>(async () => ({ ok: true, managerUrl: MANAGER_URL, token: 'tok' })),
    fetchRepos: vi.fn<OcmSwitchRuntime['fetchRepos']>(async () => [repo()]),
    resolveProjectId: vi.fn<OcmSwitchRuntime['resolveProjectId']>(async () => 'proj_a'),
    warmRepoProxy: vi.fn<OcmSwitchRuntime['warmRepoProxy']>(async () => undefined),
    readState: vi.fn<OcmSwitchRuntime['readState']>(() => ({ managerUrl: MANAGER_URL })),
    writeState: vi.fn<OcmSwitchRuntime['writeState']>(),
    setPendingWarp: vi.fn<OcmSwitchRuntime['setPendingWarp']>(),
  }
}

function switchDeps(runtime: OcmSwitchRuntime, overrides: Omit<OcmSwitchDeps, 'runtime'> = { remote: undefined }): OcmSwitchDeps {
  return { ...overrides, runtime }
}

describe('runOcmSwitch from a local TUI', () => {
  let runtime: OcmSwitchRuntime

  beforeEach(() => {
    runtime = createRuntime()
  })

  it('confirms and attaches to the single Manager repo matching this directory', async () => {
    const fake = createFakeContext()
    const match = repo()
    vi.mocked(runtime.fetchRepos).mockResolvedValue([match, repo({ repoId: 2, name: 'other', projectId: 'proj_b' })])
    fake.confirm.mockResolvedValue(true)

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/work/oc-manager' }))

    expect(runtime.resolveManagerAuth).toHaveBeenCalledWith(undefined)
    expect(runtime.resolveProjectId).toHaveBeenCalledWith('/work/oc-manager')
    expect(fake.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Switch to OpenCode Manager', message: expect.stringContaining('attach to oc-manager on manager.example') }),
    )
    expect(runtime.warmRepoProxy).toHaveBeenCalledWith(MANAGER_URL, 'tok', 1)
    expect(runtime.writeState).toHaveBeenCalledWith({
      managerUrl: MANAGER_URL,
      lastRepoId: 1,
      lastRepoName: 'oc-manager',
      lastRepoDir: '/srv/repos/oc-manager',
      lastRepoBranch: 'main',
    })
    expect(runtime.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: { managerUrl: MANAGER_URL, token: 'tok', repoId: 1, repoName: 'oc-manager' },
    })
    expect(fake.dispatch).toHaveBeenCalledWith('app.exit')
    expect(vi.mocked(runtime.warmRepoProxy).mock.invocationCallOrder[0]).toBeLessThan(fake.dispatch.mock.invocationCallOrder[0]!)
  })

  it('stays put when the switch is declined', async () => {
    const fake = createFakeContext()
    vi.mocked(runtime.fetchRepos).mockResolvedValue([repo()])
    fake.confirm.mockResolvedValue(false)

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/work/oc-manager' }))

    expect(runtime.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('uses the current session directory to find the matching repo', async () => {
    const fake = createFakeContext({ type: 'session', sessionID: 'ses_a' })
    fake.context.data.session.get = () => ({
      id: 'ses_a',
      projectID: 'proj_a',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: '/work/session-dir' },
    })

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined }))

    expect(runtime.resolveProjectId).toHaveBeenCalledWith('/work/session-dir')
  })

  it('offers a picker with matching repos first when several match, skipping repos that are not ready', async () => {
    const fake = createFakeContext()
    const main = repo()
    const worktree = repo({ repoId: 3, name: 'oc-manager-feature', branch: 'feature', isWorktree: true })
    const other = repo({ repoId: 2, name: 'other', projectId: 'proj_b', branch: null })
    vi.mocked(runtime.fetchRepos).mockResolvedValue([other, main, worktree, repo({ repoId: 4, name: 'cloning', cloneStatus: 'cloning' })])
    fake.select.mockResolvedValue({ kind: 'repo', repo: worktree })

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/work/oc-manager' }))

    expect(offeredOptions(fake).map((option) => [option.title, option.category, option.description])).toEqual([
      ['oc-manager', 'Matches this directory', 'main'],
      ['oc-manager-feature', 'Matches this directory', 'worktree · feature'],
      ['other', 'Manager repos', undefined],
    ])
    expect(runtime.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: { managerUrl: MANAGER_URL, token: 'tok', repoId: 3, repoName: 'oc-manager-feature' },
    })
  })

  it('offers every ready repo when nothing matches, and does nothing when dismissed', async () => {
    const fake = createFakeContext()
    vi.mocked(runtime.resolveProjectId).mockResolvedValue(null)
    vi.mocked(runtime.fetchRepos).mockResolvedValue([repo(), repo({ repoId: 2, name: 'other' })])
    fake.select.mockResolvedValue(undefined)

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/tmp' }))

    expect(offeredOptions(fake).map((option) => option.category)).toEqual(['Manager repos', 'Manager repos'])
    expect(runtime.warmRepoProxy).not.toHaveBeenCalled()
    expect(runtime.setPendingWarp).not.toHaveBeenCalled()
  })

  it('reports a Manager without ready repos', async () => {
    const fake = createFakeContext()
    vi.mocked(runtime.fetchRepos).mockResolvedValue([repo({ cloneStatus: 'error' })])

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/work/oc-manager' }))

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
    const runtime = createRuntime()
    const fake = createFakeContext()
    vi.mocked(runtime.fetchRepos).mockResolvedValue([repo(), repo({ repoId: 2, name: 'other' })])
    fake.select.mockResolvedValue({ kind: 'local' })

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote }))

    expect(runtime.resolveManagerAuth).toHaveBeenCalledWith(MANAGER_URL)
    expect(runtime.resolveProjectId).not.toHaveBeenCalled()
    const options = offeredOptions(fake)
    expect(options.map((option) => [option.title, option.disabled ?? false])).toEqual([
      ['Local opencode', false],
      ['oc-manager', true],
      ['other', false],
    ])
    expect(options[1]!.description).toBe('Current')
    expect(runtime.setPendingWarp).toHaveBeenCalledWith({ kind: 'local' })
    expect(runtime.warmRepoProxy).not.toHaveBeenCalled()
    expect(fake.dispatch).toHaveBeenCalledWith('app.exit')
  })

  it('switches to another Manager repo', async () => {
    const runtime = createRuntime()
    const fake = createFakeContext()
    const other = repo({ repoId: 2, name: 'other' })
    vi.mocked(runtime.fetchRepos).mockResolvedValue([repo(), other])
    fake.select.mockResolvedValue({ kind: 'repo', repo: other })

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote }))

    expect(runtime.setPendingWarp).toHaveBeenCalledWith({
      kind: 'attach',
      target: { managerUrl: MANAGER_URL, token: 'tok', repoId: 2, repoName: 'other' },
    })
  })
})

describe('runOcmSwitch failures', () => {
  it('reports an auth failure without contacting the Manager', async () => {
    const runtime = createRuntime()
    const fake = createFakeContext()
    vi.mocked(runtime.resolveManagerAuth).mockResolvedValue({ ok: false, reason: 'no-manager', message: 'No manager configured. Run `ocm login <url>` first.' })

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined }))

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'No manager configured. Run `ocm login <url>` first.' })
    expect(runtime.fetchRepos).not.toHaveBeenCalled()
  })

  it('reports a Manager request failure and does not exit', async () => {
    const runtime = createRuntime()
    const fake = createFakeContext()
    vi.mocked(runtime.fetchRepos).mockRejectedValue(new Error('manager responded 502 Bad Gateway'))

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/work/oc-manager' }))

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'manager responded 502 Bad Gateway' })
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('does not exit when the repo proxy cannot be warmed', async () => {
    const runtime = createRuntime()
    const fake = createFakeContext()
    vi.mocked(runtime.fetchRepos).mockResolvedValue([repo()])
    fake.confirm.mockResolvedValue(true)
    vi.mocked(runtime.warmRepoProxy).mockRejectedValue(new Error('Manager is older than ocm requires'))

    await runOcmSwitch(fake.context, switchDeps(runtime, { remote: undefined, cwd: '/work/oc-manager' }))

    expect(fake.toast).toHaveBeenCalledWith({ variant: 'error', message: 'Manager is older than ocm requires' })
    expect(runtime.setPendingWarp).not.toHaveBeenCalled()
    expect(fake.dispatch).not.toHaveBeenCalled()
  })
})
