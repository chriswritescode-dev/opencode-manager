import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { createRepo, deleteRepo } from '../../src/db/queries'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createMultiRunWithEntries } from '../../src/db/multi-runs'
import { MultiRunError, MultiRunService } from '../../src/services/multi-runs'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'

const REPO_DIR = '/repos/repo-a'

const mocks = vi.hoisted(() => ({
  resolveOpenCodeModel: vi.fn(),
  resolveProjectId: vi.fn(),
  isGitMainCheckout: vi.fn(),
  executeCommand: vi.fn(),
  existsSync: vi.fn(),
}))

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: mocks.resolveOpenCodeModel,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: mocks.existsSync }
})

vi.mock('../../src/services/project-id-resolver', () => ({
  resolveProjectId: mocks.resolveProjectId,
  isGitMainCheckout: mocks.isGitMainCheckout,
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand: mocks.executeCommand,
}))

interface FakeMultiRunClient {
  client: OpenCodeClient
  sessionCreate: ReturnType<typeof vi.fn>
  sessionPrompt: ReturnType<typeof vi.fn>
  worktreeCreate: ReturnType<typeof vi.fn>
  worktreeList: ReturnType<typeof vi.fn>
  worktreeRemove: ReturnType<typeof vi.fn>
  workspaces: Array<{ directory: string; strategy: string }>
}

function createClient(): FakeMultiRunClient {
  let sessionCounter = 0
  const workspaces: Array<{ directory: string; strategy: string }> = []

  const sessionCreate = vi.fn(async (input: { title?: string }) => {
    sessionCounter += 1
    return { id: `ses_${sessionCounter}`, title: input?.title }
  })
  const sessionPrompt = vi.fn(async () => ({}))
  const worktreeCreate = vi.fn(async (input: { name?: string }) => {
    const directory = `/worktrees/${input.name ?? 'workspace'}`
    workspaces.push({ directory, strategy: 'git' })
    return { directory }
  })
  const worktreeList = vi.fn(async () => workspaces)
  const worktreeRemove = vi.fn(async () => undefined)

  const client = {
    api: {
      location: {
        get: vi.fn(async () => ({ project: { id: 'commit-A', directory: REPO_DIR, canonical: REPO_DIR } })),
      },
      worktree: { create: worktreeCreate, list: worktreeList, remove: worktreeRemove },
      session: { create: sessionCreate, prompt: sessionPrompt },
    },
  } as unknown as OpenCodeClient

  return { client, sessionCreate, sessionPrompt, worktreeCreate, worktreeList, worktreeRemove, workspaces }
}

describe('MultiRunService', () => {
  let db: Database

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    mocks.existsSync.mockReturnValue(true)

    mocks.resolveOpenCodeModel.mockImplementation(
      async (_client: unknown, _directory: string, options: { preferredModel?: string }) => {
        const preferred = options?.preferredModel
        if (!preferred) {
          return { providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5' }
        }
        if (preferred === 'openai/retired') {
          return { providerID: 'openai', id: 'retired-x', model: 'openai/retired-x' }
        }
        const [providerID, ...rest] = preferred.split('/')
        return { providerID, id: rest.join('/'), model: preferred }
      },
    )
    mocks.resolveProjectId.mockResolvedValue('commit-A')
    mocks.isGitMainCheckout.mockResolvedValue(false)
    mocks.executeCommand.mockResolvedValue('')
  })

  afterEach(() => {
    db.close()
  })

  function readyRepo(): number {
    const repo = createRepo(db, {
      localPath: 'repo-a',
      sourcePath: REPO_DIR,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
    return repo.id
  }

  function createService(client: OpenCodeClient): MultiRunService {
    const gitAuthService = { getGitEnvironment: () => ({}) } as unknown as GitAuthService
    return new MultiRunService(db, client, gitAuthService)
  }

  it('launches one session per model, each in its own workspace named from the group', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate, sessionPrompt, worktreeCreate } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Feature Sweep',
      prompt: 'do the thing',
      models: ['openai/a', 'openai/b', 'openai/c'],
      isolate: true,
      baseRef: 'develop',
    })

    expect(run).toMatchObject({
      repoId,
      name: 'Feature Sweep',
      prompt: 'do the thing',
      isolated: true,
      baseRef: 'develop',
    })
    expect(run.entries.map((entry) => entry.model)).toEqual(['openai/a', 'openai/b', 'openai/c'])
    expect(run.entries.map((entry) => entry.status)).toEqual(['started', 'started', 'started'])
    expect(run.entries.map((entry) => entry.isolated)).toEqual([true, true, true])
    expect(run.entries.map((entry) => entry.directory)).toEqual([
      '/worktrees/Feature-Sweep-1',
      '/worktrees/Feature-Sweep-2',
      '/worktrees/Feature-Sweep-3',
    ])
    expect(new Set(run.entries.map((entry) => entry.sessionId)).size).toBe(3)

    expect(sessionCreate).toHaveBeenCalledTimes(3)
    expect(sessionPrompt).toHaveBeenCalledTimes(3)
    expect(sessionPrompt.mock.calls.every((call) => call[0].text === 'do the thing')).toBe(true)
    expect(
      sessionCreate.mock.calls.map((call) => `${call[0].model.providerID}/${call[0].model.id}`).sort(),
    ).toEqual(['openai/a', 'openai/b', 'openai/c'])

    const workspaceCalls = worktreeCreate.mock.calls.map((call) => call[0])
    expect(workspaceCalls.map((call) => call.name).sort()).toEqual([
      'Feature-Sweep-1',
      'Feature-Sweep-2',
      'Feature-Sweep-3',
    ])
    expect(workspaceCalls.every((call) => call.branch === 'develop')).toBe(true)
  })

  it('keeps launching the other models when one model fails', async () => {
    const repoId = readyRepo()
    const { client, worktreeCreate } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/retired', 'openai/c'],
      isolate: false,
    })

    expect(run.entries.map((entry) => entry.status)).toEqual(['started', 'failed', 'started'])
    expect(run.entries[1]!.error).toBe('Model openai/retired is not available')
    expect(run.entries[1]!.sessionId).toBeNull()
    expect(run.entries[0]!.sessionId).toBeTruthy()
    expect(run.entries[2]!.sessionId).toBeTruthy()
    expect(worktreeCreate).not.toHaveBeenCalled()
  })

  it('does not create workspaces when isolation is off', async () => {
    const repoId = readyRepo()
    const { client, worktreeCreate } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: false,
    })

    expect(run.entries.map((entry) => entry.status)).toEqual(['started', 'started'])
    expect(run.entries.every((entry) => entry.directory === REPO_DIR)).toBe(true)
    expect(run.entries.every((entry) => entry.isolated === false)).toBe(true)
    expect(worktreeCreate).not.toHaveBeenCalled()
  })

  it('rejects a repository that is not ready', async () => {
    const { client } = createClient()
    const service = createService(client)

    const error = await service
      .launch({ repoId: 999, name: 'Sweep', prompt: 'go', models: ['openai/a'], isolate: false })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 404 })
  })

  it('removes the workspace when discarding an isolated entry', async () => {
    const repoId = readyRepo()
    const { client, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!
    expect(entry.directory).toBe('/worktrees/Sweep-1')

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).toHaveBeenCalledWith({
      projectID: 'commit-A',
      directory: '/worktrees/Sweep-1',
      force: true,
    })
  })

  it('rejects discarding an entry twice', async () => {
    const repoId = readyRepo()
    const { client, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!
    await service.discard(run.id, entry.id)

    const error = await service.discard(run.id, entry.id).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 409 })
    expect(worktreeRemove).toHaveBeenCalledTimes(1)
  })

  it('does not remove a workspace when discarding a non-isolated entry', async () => {
    const repoId = readyRepo()
    const { client, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: false,
    })

    const discarded = await service.discard(run.id, run.entries[0]!.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).not.toHaveBeenCalled()
  })

  it('fails only the entry whose model is unavailable and creates no workspace for it', async () => {
    const repoId = readyRepo()
    const { client, worktreeCreate, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/retired', 'openai/c'],
      isolate: true,
    })

    expect(run.entries.map((entry) => entry.status)).toEqual(['started', 'failed', 'started'])
    expect(run.entries[1]!.directory).toBeNull()
    expect(run.entries[1]!.sessionId).toBeNull()
    expect(run.entries[1]!.error).toBe('Model openai/retired is not available')
    expect(run.entries[0]!.directory).toBe('/worktrees/Sweep-1')
    expect(run.entries[2]!.directory).toBe('/worktrees/Sweep-3')

    expect(worktreeCreate).toHaveBeenCalledTimes(2)
    expect(worktreeCreate.mock.calls.map((call) => call[0].name).sort()).toEqual(['Sweep-1', 'Sweep-3'])
    expect(worktreeRemove).not.toHaveBeenCalled()
  })

  it('marks an isolated entry discarded when its workspace directory is gone', async () => {
    const repoId = readyRepo()
    const { client, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!
    expect(entry.directory).toBe('/worktrees/Sweep-1')

    mocks.existsSync.mockReturnValue(false)
    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).not.toHaveBeenCalled()
  })

  it('maps a workspace that is not a deletable sibling to 400 and keeps the entry retryable', async () => {
    const repoId = readyRepo()
    const { client, workspaces, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    workspaces.length = 0

    const error = await service.discard(run.id, entry.id).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 400 })
    expect(worktreeRemove).not.toHaveBeenCalled()
    expect(service.list(repoId)[0]!.entries[0]!.status).toBe('started')
  })

  it('records the workspace of a failed isolated launch when prompting fails and removes it on discard', async () => {
    const repoId = readyRepo()
    const { client, sessionPrompt, worktreeRemove } = createClient()
    sessionPrompt.mockRejectedValueOnce(new Error('prompt boom'))
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    expect(entry.status).toBe('failed')
    expect(entry.directory).toBe('/worktrees/Sweep-1')
    expect(entry.error).toContain('prompt boom')

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).toHaveBeenCalledTimes(1)
  })

  it('does not record or remove a workspace when isolated workspace creation fails', async () => {
    const repoId = readyRepo()
    const { client, worktreeCreate, worktreeRemove } = createClient()
    worktreeCreate.mockRejectedValueOnce(new Error('no workspace'))
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    expect(entry.status).toBe('failed')
    expect(entry.directory).toBeNull()

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).not.toHaveBeenCalled()
  })

  it('removes the workspace once when discards race', async () => {
    const repoId = readyRepo()
    const { client, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    let releaseRemoval: () => void = () => {}
    worktreeRemove.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseRemoval = resolve
      }),
    )

    const first = service.discard(run.id, entry.id)
    const second = service.discard(run.id, entry.id).catch((caught: unknown) => caught)

    const error = await second
    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 409 })

    releaseRemoval()
    const discarded = await first

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).toHaveBeenCalledTimes(1)
  })

  it('keeps the entry retryable when workspace removal fails', async () => {
    const repoId = readyRepo()
    const { client, worktreeRemove } = createClient()
    const service = createService(client)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    worktreeRemove.mockRejectedValueOnce(new Error('removal failed'))

    const error = await service.discard(run.id, entry.id).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 502 })

    expect(service.list(repoId)[0]!.entries[0]!.status).toBe('started')

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(worktreeRemove).toHaveBeenCalledTimes(2)
  })

  it('lists the most recent groups for a repository', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const service = createService(client)

    await service.launch({ repoId, name: 'First', prompt: 'go', models: ['openai/a'], isolate: false })
    await service.launch({ repoId, name: 'Second', prompt: 'go', models: ['openai/b'], isolate: false })

    const runs = service.list(repoId)

    expect(runs.map((run) => run.name)).toEqual(['Second', 'First'])
  })

  it('persists the group and its entries in one transaction', () => {
    const repoId = readyRepo()
    db.run(`CREATE TRIGGER fail_entry BEFORE INSERT ON multi_run_entries BEGIN SELECT RAISE(ABORT, 'nope'); END`)

    expect(() =>
      createMultiRunWithEntries(db, { repoId, name: 'Sweep', prompt: 'go', isolated: false, baseRef: null }, [
        'openai/a',
        'openai/b',
      ]),
    ).toThrow()

    const count = db.prepare('SELECT COUNT(*) AS count FROM multi_runs').get() as { count: number }
    expect(count.count).toBe(0)
  })

  it('deletes the repository multi-run rows when the repository is deleted', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const service = createService(client)

    await service.launch({ repoId, name: 'Sweep', prompt: 'go', models: ['openai/a'], isolate: false })

    deleteRepo(db, repoId)

    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_runs').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_run_entries').get()).toEqual({ count: 0 })
  })
})
