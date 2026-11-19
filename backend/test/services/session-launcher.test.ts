import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { RepoWorkspaceProvider } from '../../src/services/repo-workspace'
import { SessionLauncher, SessionLaunchError } from '../../src/services/session-launcher'
import { createStubOpenCodeClient, sessionInfo, stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { sessionInboxUser } from '../helpers/stub-schedule-api'
import type { Repo } from '../../src/types/repo'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { catchRejectedError } from '../helpers/thrown-error'


function createClient(overrides: { createError?: Error; promptError?: Error } = {}) {
  const catalog = stubLoadedModelCatalog()
  const create = vi.fn<OpenCodeApi['session']['create']>(async (input) => {
    if (overrides.createError) throw overrides.createError
    return sessionInfo({ id: 'ses_new', title: input?.title ?? undefined })
  })
  const prompt = vi.fn<OpenCodeApi['session']['prompt']>(async () => {
    if (overrides.promptError) throw overrides.promptError
    return sessionInboxUser('ses_new')
  })
  const client = createStubOpenCodeClient({
    api: { session: { create, prompt }, config: catalog.config, model: catalog.model },
  })
  return { client, catalog, create, prompt }
}

function createRepoWorkspaces(overrides: { directory?: string; createError?: Error } = {}) {
  const create = vi.fn<RepoWorkspaceProvider['create']>(async () => {
    if (overrides.createError) throw overrides.createError
    return { directory: overrides.directory ?? '/worktrees/feature-x', worktreeSetup: { status: 'none' as const } }
  })
  const remove = vi.fn<RepoWorkspaceProvider['remove']>(async () => undefined)
  const provider: RepoWorkspaceProvider = { create, remove }
  return { provider, create, remove }
}

describe('SessionLauncher', () => {
  let db: Database
  let repo: Repo

  beforeEach(() => {
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'repo-a' })
  })

  afterEach(() => {
    db.close()
  })

  it('launches in the repo directory with the resolved model and sends the prompt', async () => {
    const { client, catalog, create, prompt } = createClient()
    const { provider, create: createWorkspace } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, provider)

    const result = await launcher.launch({ repoId: repo.id, prompt: 'hello', title: 'T', agent: 'build', model: 'openai/gpt-5-mini' })

    expect(vi.mocked(catalog.model.list)).toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'T',
        agent: 'build',
        model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
        location: { directory: repo.fullPath },
      }),
    )
    expect(prompt).toHaveBeenCalledWith({ sessionID: 'ses_new', text: 'hello' })
    expect(result).toEqual({
      sessionId: 'ses_new',
      repoId: repo.id,
      directory: repo.fullPath,
      workspaceDirectory: null,
      model: 'openai/gpt-5-mini',
      title: 'T',
    })
  })

  it('forwards a permission ruleset to session creation when provided', async () => {
    const { client, create } = createClient()
    const { provider } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, provider)
    const permissions = [
      { action: 'external_directory', resource: '/repos/source/*', effect: 'allow' as const },
      { action: 'edit', resource: '/repos/source/*', effect: 'deny' as const },
    ]

    await launcher.launch({ repoId: repo.id, prompt: 'hello', permissions })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ permissions }))
  })

  it('omits the permissions key from session creation when none are given', async () => {
    const { client, create } = createClient()
    const { provider } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, provider)

    await launcher.launch({ repoId: repo.id, prompt: 'hello' })

    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('permissions')
  })

  it('launches in a new workspace and prompts there', async () => {
    const { client } = createClient()
    const { provider, create: createWorkspace } = createRepoWorkspaces({ directory: '/worktrees/feature-x' })
    const launcher = new SessionLauncher(db, client, provider)

    const result = await launcher.launch({
      repoId: repo.id,
      prompt: 'hello',
      workspace: { name: 'feature-x', ref: 'feature/x' },
    })

    expect(createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: repo.id }),
      { name: 'feature-x', ref: 'feature/x' },
    )
    expect(result).toMatchObject({
      sessionId: 'ses_new',
      repoId: repo.id,
      directory: '/worktrees/feature-x',
      workspaceDirectory: '/worktrees/feature-x',
    })
  })

  it('rejects an unavailable requested model before creating a workspace or session', async () => {
    const { client, create } = createClient()
    const { provider, create: createWorkspace } = createRepoWorkspaces()
    const loadModel = vi.fn(async () => ({ providerID: 'openai', id: 'gpt-5-mini', model: 'openai/gpt-5-mini' }))
    const launcher = new SessionLauncher(db, client, provider, undefined, loadModel)

    const error = await catchRejectedError(
      launcher.launch({ repoId: repo.id, prompt: 'hello', model: 'openai/retired', workspace: { name: 'feature-x' } }),
    )

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({
      status: 400,
      message: 'Model openai/retired is not available',
      workspaceDirectory: null,
    })
    expect(loadModel).toHaveBeenCalledWith(client, repo.fullPath, { preferredModel: 'openai/retired' })
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('slugs a raw workspace name before creating the workspace', async () => {
    const { client } = createClient()
    const { provider, create: createWorkspace } = createRepoWorkspaces({ directory: '/worktrees/Feature-Sweep' })
    const launcher = new SessionLauncher(db, client, provider)

    await launcher.launch({ repoId: repo.id, prompt: 'hello', workspace: { name: 'Feature Sweep!' } })

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: repo.id }), { name: 'Feature-Sweep' })
  })

  it('rejects a repo that is not ready', async () => {
    const cloningRepoId = seedRepo(db, { localPath: 'repo-b', cloneStatus: 'cloning' }).id
    const { client, catalog, create } = createClient()
    const { provider, create: createWorkspace } = createRepoWorkspaces()
    const launcher = new SessionLauncher(db, client, provider)

    const error = await catchRejectedError(launcher.launch({ repoId: cloningRepoId, prompt: 'hello' }))

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({ status: 404 })
    expect(create).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(vi.mocked(catalog.model.list)).not.toHaveBeenCalled()
  })

  it('keeps a created workspace and names it when session creation fails', async () => {
    const { client } = createClient({ createError: new Error('boom') })
    const { provider, create: createWorkspace } = createRepoWorkspaces({ directory: '/worktrees/feature-x' })
    const launcher = new SessionLauncher(db, client, provider)

    const error = await catchRejectedError(launcher.launch({ repoId: repo.id, prompt: 'hello', workspace: { name: 'feature-x' } }))

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
    const { client, create } = createClient({ promptError: new Error('prompt boom') })
    const { provider } = createRepoWorkspaces({ directory: '/worktrees/feature-x' })
    const launcher = new SessionLauncher(db, client, provider)

    const error = await catchRejectedError(launcher.launch({ repoId: repo.id, prompt: 'hello', workspace: { name: 'feature-x' } }))

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
    const { client } = createClient()
    const { provider } = createRepoWorkspaces({ createError: new Error('no workspace') })
    const launcher = new SessionLauncher(db, client, provider)

    const error = await catchRejectedError(launcher.launch({ repoId: repo.id, prompt: 'hello', workspace: { name: 'feature-x' } }))

    expect(error).toBeInstanceOf(SessionLaunchError)
    expect(error).toMatchObject({ status: 502, workspaceDirectory: null })
  })
})
