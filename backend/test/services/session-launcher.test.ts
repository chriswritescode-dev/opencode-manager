import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { RepoWorkspaceService } from '../../src/services/repo-workspace'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { SessionLauncher, SessionLaunchError } from '../../src/services/session-launcher'

const mocks = vi.hoisted(() => ({
  resolveOpenCodeModel: vi.fn(),
}))

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: mocks.resolveOpenCodeModel,
}))

const REPO_DIR = '/repos/repo-a'

interface FakeLaunchClient {
  client: OpenCodeClient
  create: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
}

function createClient(overrides: { createError?: Error; promptError?: Error } = {}): FakeLaunchClient {
  const create = vi.fn(async (input: { title?: string }) => {
    if (overrides.createError) throw overrides.createError
    return { id: 'ses_new', title: input?.title }
  })
  const prompt = vi.fn(async () => {
    if (overrides.promptError) throw overrides.promptError
    return {}
  })

  const client = {
    api: {
      session: { create, prompt },
    },
  } as unknown as OpenCodeClient

  return { client, create, prompt }
}

interface FakeRepoWorkspaces {
  service: RepoWorkspaceService
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  removeRepoTerminals: ReturnType<typeof vi.fn>
}

function createRepoWorkspaces(
  overrides: { directory?: string; createError?: Error } = {},
): FakeRepoWorkspaces {
  const create = vi.fn(async () => {
    if (overrides.createError) throw overrides.createError
    return { directory: overrides.directory ?? '/worktrees/feature-x', worktreeSetup: { status: 'none' as const } }
  })
  const remove = vi.fn(async () => undefined)
  const removeRepoTerminals = vi.fn(async () => undefined)

  return {
    service: { create, remove, removeRepoTerminals } as unknown as RepoWorkspaceService,
    create,
    remove,
    removeRepoTerminals,
  }
}

describe('SessionLauncher', () => {
  let db: Database

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5' })
  })

  afterEach(() => {
    db.close()
  })

  function readyRepo(overrides: { cloneStatus?: 'cloning' | 'ready' | 'error' } = {}): number {
    const repo = createRepo(db, {
      localPath: 'repo-a',
      sourcePath: REPO_DIR,
      defaultBranch: 'main',
      cloneStatus: overrides.cloneStatus ?? 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
    return repo.id
  }

  it('launches in the repo directory with the resolved model and sends the prompt', async () => {
    const repoId = readyRepo()
    const { client, create, prompt } = createClient()
    const { service, create: createWorkspace } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, service)

    const result = await launcher.launch({ repoId, prompt: 'hello', title: 'T', agent: 'build', model: 'openai/gpt-5' })

    expect(mocks.resolveOpenCodeModel).toHaveBeenCalledWith(client, REPO_DIR, { preferredModel: 'openai/gpt-5' })
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'T',
        agent: 'build',
        model: { providerID: 'openai', id: 'gpt-5' },
        location: { directory: REPO_DIR },
      }),
    )
    expect(prompt).toHaveBeenCalledWith({ sessionID: 'ses_new', text: 'hello' })
    expect(result).toEqual({
      sessionId: 'ses_new',
      repoId,
      directory: REPO_DIR,
      workspaceDirectory: null,
      model: 'openai/gpt-5',
      title: 'T',
    })
  })

  it('forwards a permission ruleset to session creation when provided', async () => {
    const repoId = readyRepo()
    const { client, create } = createClient()
    const { service } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, service)
    const permissions = [
      { action: 'external_directory', resource: '/repos/source/*', effect: 'allow' as const },
      { action: 'edit', resource: '/repos/source/*', effect: 'deny' as const },
    ]

    await launcher.launch({ repoId, prompt: 'hello', permissions })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ permissions }))
  })

  it('omits the permissions key from session creation when none are given', async () => {
    const repoId = readyRepo()
    const { client, create } = createClient()
    const { service } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, service)

    await launcher.launch({ repoId, prompt: 'hello' })

    expect(create.mock.calls[0]![0]).not.toHaveProperty('permissions')
  })

  it('launches in a new workspace and prompts there', async () => {
    const repoId = readyRepo()
    const { client, create } = createClient()
    const { service, create: createWorkspace } = createRepoWorkspaces({ directory: '/worktrees/feature-x' })
    const launcher = new SessionLauncher(db, client, service)

    const result = await launcher.launch({
      repoId,
      prompt: 'hello',
      workspace: { name: 'feature-x', ref: 'feature/x' },
    })

    expect(createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: repoId }),
      { name: 'feature-x', ref: 'feature/x' },
    )
    expect(mocks.resolveOpenCodeModel).toHaveBeenCalledWith(client, REPO_DIR, { preferredModel: undefined })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ location: { directory: '/worktrees/feature-x' } }))
    expect(result).toMatchObject({
      sessionId: 'ses_new',
      repoId,
      directory: '/worktrees/feature-x',
      workspaceDirectory: '/worktrees/feature-x',
    })
  })

  it('rejects an unavailable requested model before creating a workspace or session', async () => {
    const repoId = readyRepo()
    const { client, create } = createClient()
    const { service, create: createWorkspace } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, service)

    const error = await launcher
      .launch({ repoId, prompt: 'hello', model: 'openai/retired', workspace: { name: 'feature-x' } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({
      status: 400,
      message: 'Model openai/retired is not available',
      workspaceDirectory: null,
    })
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('slugs a raw workspace name before creating the workspace', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const { service, create: createWorkspace } = createRepoWorkspaces({ directory: '/worktrees/Feature-Sweep' })
    const launcher = new SessionLauncher(db, client, service)

    await launcher.launch({ repoId, prompt: 'hello', workspace: { name: 'Feature Sweep!' } })

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: repoId }), { name: 'Feature-Sweep' })
  })

  it('rejects a repo that is not ready', async () => {
    const repoId = readyRepo({ cloneStatus: 'cloning' })
    const { client, create } = createClient()
    const { service, create: createWorkspace } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, service)

    const error = await launcher.launch({ repoId, prompt: 'hello' }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({ status: 404 })
    expect(create).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(mocks.resolveOpenCodeModel).not.toHaveBeenCalled()
  })

  it('keeps a created workspace and names it when session creation fails', async () => {
    const repoId = readyRepo()
    const { client } = createClient({ createError: new Error('boom') })
    const { service, create: createWorkspace } = createRepoWorkspaces({ directory: '/worktrees/feature-x' })
    const launcher = new SessionLauncher(db, client, service)

    const error = await launcher.launch({ repoId, prompt: 'hello', workspace: { name: 'feature-x' } }).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({
      status: 502,
      message: 'boom (workspace: /worktrees/feature-x)',
      workspaceDirectory: '/worktrees/feature-x',
      sessionId: null,
    })
    expect(createWorkspace).toHaveBeenCalled()
  })

  it('keeps the created session id when prompting the session fails', async () => {
    const repoId = readyRepo()
    const { client, create } = createClient({ promptError: new Error('prompt boom') })
    const { service } = createRepoWorkspaces({ directory: '/worktrees/feature-x' })
    const launcher = new SessionLauncher(db, client, service)

    const error = await launcher.launch({ repoId, prompt: 'hello', workspace: { name: 'feature-x' } }).catch(
      (caught: unknown) => caught,
    )

    expect(create).toHaveBeenCalled()
    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({
      status: 502,
      message: 'prompt boom (workspace: /worktrees/feature-x)',
      workspaceDirectory: '/worktrees/feature-x',
      sessionId: 'ses_new',
    })
  })

  it('exposes no workspace when workspace creation fails', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const { service } = createRepoWorkspaces({ createError: new Error('no workspace') })
    const launcher = new SessionLauncher(db, client, service)

    const error = await launcher
      .launch({ repoId, prompt: 'hello', workspace: { name: 'feature-x' } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({ status: 502, workspaceDirectory: null })
  })
})
