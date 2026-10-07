import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'
import { createRepo, deleteRepo } from '../../src/db/queries'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createMultiRunWithEntries } from '../../src/db/multi-runs'
import { getSessionPermissionMode } from '../../src/db/session-permission-modes'
import { FusionContextLimitError } from '../../src/services/multi-run-fusion'
import { MultiRunError, MultiRunService } from '../../src/services/multi-runs'
import { RepoWorkspaceError } from '../../src/services/repo'
import type { RepoWorkspaceService } from '../../src/services/repo-workspace'
import { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import { SettingsService } from '../../src/services/settings'
import type { Repo } from '../../src/types/repo'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { assistantMessage } from '../helpers/stub-schedule-api'

const FUSE_REQUEST_ID = '11111111-1111-4111-8111-111111111111'

const REPO_DIR = '/repos/repo-a'

const mocks = vi.hoisted(() => ({
  resolveOpenCodeModel: vi.fn(),
  resolveProjectId: vi.fn(),
  isGitMainCheckout: vi.fn(),
  executeCommand: vi.fn(),
  existsSync: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mocks.loggerError, debug: vi.fn() },
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

interface FakeSessionConfig {
  busy?: boolean
  missing?: boolean
  reply?: string
  outcome?: 'succeeded' | 'failed' | 'interrupted'
  hasUserMessage?: boolean
}

interface FakeMultiRunClient {
  client: OpenCodeClient
  sessionCreate: ReturnType<typeof vi.fn>
  sessionPrompt: ReturnType<typeof vi.fn>
  sessionGet: ReturnType<typeof vi.fn>
  sessionActive: ReturnType<typeof vi.fn>
  messageList: ReturnType<typeof vi.fn>
  sessionDiff: ReturnType<typeof vi.fn>
}

function notFoundError(): Error {
  return Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
}

function createClient(sessions: Record<string, FakeSessionConfig> = {}): FakeMultiRunClient {
  let sessionCounter = 0

  const sessionCreate = vi.fn(async (input: { title?: string }) => {
    sessionCounter += 1
    return { id: `ses_${sessionCounter}`, title: input?.title }
  })
  const sessionPrompt = vi.fn(async () => ({}))

  const sessionGet = vi.fn(async ({ sessionID }: { sessionID: string }) => {
    const config = sessions[sessionID]
    if (config?.missing) {
      throw notFoundError()
    }
    return { id: sessionID, outcome: config?.outcome ?? 'succeeded' }
  })

  const sessionActive = vi.fn(async () => {
    const active: Record<string, unknown> = {}
    for (const [id, config] of Object.entries(sessions)) {
      if (config.busy) {
        active[id] = { type: 'running' }
      }
    }
    return active
  })

  const messageList = vi.fn(async (input: { sessionID: string; type?: string; order?: 'asc' | 'desc' }) => {
    if (input.type === 'user') {
      if (sessions[input.sessionID]?.hasUserMessage === false) {
        return { data: [], cursor: {} }
      }
      return {
        data: [{ id: `${input.sessionID}-user-${input.order}`, type: 'user', time: { created: 0 }, text: 'hi' }],
        cursor: {},
      }
    }
    return {
      data: [assistantMessage(sessions[input.sessionID]?.reply ?? 'Fusion source reply', { completed: true })],
      cursor: {},
    }
  })

  const sessionDiff = vi.fn(async () => [])

  const permissionRequestList = vi.fn(async () => ({ data: [] }))
  const permissionReply = vi.fn(async () => ({}))

  const client = {
    api: {
      session: {
        create: sessionCreate,
        prompt: sessionPrompt,
        get: sessionGet,
        active: sessionActive,
        diff: sessionDiff,
      },
      message: { list: messageList },
      permission: {
        request: { list: permissionRequestList },
        reply: permissionReply,
      },
    },
  } as unknown as OpenCodeClient

  return { client, sessionCreate, sessionPrompt, sessionGet, sessionActive, messageList, sessionDiff }
}

interface FakeRepoWorkspaces {
  service: RepoWorkspaceService
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  removeRepoTerminals: ReturnType<typeof vi.fn>
}

function createRepoWorkspaces(): FakeRepoWorkspaces {
  const known = new Set<string>()
  const create = vi.fn(async (_repo: Repo, options: { name?: string } = {}) => {
    const directory = `/worktrees/${options.name ?? 'workspace'}`
    known.add(directory)
    return { directory, worktreeSetup: { status: 'none' as const } }
  })
  const remove = vi.fn(async (_repo: Repo, directory: string) => {
    if (!known.has(directory)) {
      throw new RepoWorkspaceError('Not a deletable worktree of this repo', 400)
    }
    known.delete(directory)
  })
  const removeRepoTerminals = vi.fn(async () => undefined)

  return {
    service: { create, remove, removeRepoTerminals } as unknown as RepoWorkspaceService,
    create,
    remove,
    removeRepoTerminals,
  }
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

  function createService(
    client: OpenCodeClient,
    repoWorkspaces: RepoWorkspaceService,
    permissionModes: SessionPermissionModeService = new SessionPermissionModeService(
      db,
      client,
      new SettingsService(db),
    ),
  ): MultiRunService {
    return new MultiRunService(db, client, repoWorkspaces, permissionModes)
  }

  it('launches one session per model, each in its own workspace named from the group', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate, sessionPrompt } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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

    const workspaceCalls = repoWorkspaces.create.mock.calls.map((call) => call[1])
    expect(workspaceCalls.map((call) => call.name).sort()).toEqual([
      'Feature-Sweep-1',
      'Feature-Sweep-2',
      'Feature-Sweep-3',
    ])
    expect(workspaceCalls.every((call) => call.ref === 'develop')).toBe(true)
  })

  it('keeps launching the other models when one model fails', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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
    expect(repoWorkspaces.create).not.toHaveBeenCalled()
  })

  it('does not create workspaces when isolation is off', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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
    expect(repoWorkspaces.create).not.toHaveBeenCalled()
  })

  it('rejects a repository that is not ready', async () => {
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const error = await service
      .launch({ repoId: 999, name: 'Sweep', prompt: 'go', models: ['openai/a'], isolate: false })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 404 })
  })

  it('removes the workspace when discarding an isolated entry', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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
    expect(repoWorkspaces.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: repoId }),
      '/worktrees/Sweep-1',
    )
  })

  it('rejects discarding an entry twice', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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
    expect(repoWorkspaces.remove).toHaveBeenCalledTimes(1)
  })

  it('does not remove a workspace when discarding a non-isolated entry', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: false,
    })

    const discarded = await service.discard(run.id, run.entries[0]!.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(repoWorkspaces.remove).not.toHaveBeenCalled()
  })

  it('fails only the entry whose model is unavailable and creates no workspace for it', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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

    expect(repoWorkspaces.create).toHaveBeenCalledTimes(2)
    expect(repoWorkspaces.create.mock.calls.map((call) => call[1].name).sort()).toEqual(['Sweep-1', 'Sweep-3'])
    expect(repoWorkspaces.remove).not.toHaveBeenCalled()
  })

  it('marks an isolated entry discarded when its workspace directory is gone', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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
    expect(repoWorkspaces.remove).not.toHaveBeenCalled()
  })

  it('maps a workspace that is not a deletable sibling to 400 and keeps the entry retryable', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    repoWorkspaces.remove.mockRejectedValueOnce(
      new RepoWorkspaceError('Not a deletable worktree of this repo', 400),
    )

    const error = await service.discard(run.id, entry.id).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 400 })
    expect(repoWorkspaces.remove).toHaveBeenCalledTimes(1)
    expect(service.list(repoId)[0]!.entries[0]!.status).toBe('started')
  })

  it('records the workspace of a failed isolated launch when prompting fails and removes it on discard', async () => {
    const repoId = readyRepo()
    const { client, sessionPrompt } = createClient()
    sessionPrompt.mockRejectedValueOnce(new Error('prompt boom'))
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

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
    expect(entry.sessionId).toBe('ses_1')

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(repoWorkspaces.remove).toHaveBeenCalledTimes(1)
  })

  it('does not record or remove a workspace when isolated workspace creation fails', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    repoWorkspaces.create.mockRejectedValueOnce(new Error('no workspace'))
    const service = createService(client, repoWorkspaces.service)

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
    expect(repoWorkspaces.remove).not.toHaveBeenCalled()
  })

  it('removes the workspace once when discards race', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    let releaseRemoval: () => void = () => {}
    repoWorkspaces.remove.mockReturnValueOnce(
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
    expect(repoWorkspaces.remove).toHaveBeenCalledTimes(1)
  })

  it('keeps the entry retryable when workspace removal fails', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
    })
    const entry = run.entries[0]!

    repoWorkspaces.remove.mockRejectedValueOnce(new Error('removal failed'))

    const error = await service.discard(run.id, entry.id).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 502 })

    expect(service.list(repoId)[0]!.entries[0]!.status).toBe('started')

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(repoWorkspaces.remove).toHaveBeenCalledTimes(2)
  })

  it('lists the most recent groups for a repository', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    await service.launch({ repoId, name: 'First', prompt: 'go', models: ['openai/a'], isolate: false })
    await service.launch({ repoId, name: 'Second', prompt: 'go', models: ['openai/b'], isolate: false })

    const runs = service.list(repoId)

    expect(runs.map((run) => run.name)).toEqual(['Second', 'First'])
  })

  it('fuses completed entries into one new session and records the sources', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate, sessionPrompt } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'do the thing',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    const sessionIds = run.entries.map((entry) => entry.sessionId)
    const before = run.entries.map((entry) => ({
      status: entry.status,
      sessionId: entry.sessionId,
      directory: entry.directory,
    }))
    sessionCreate.mockClear()
    sessionPrompt.mockClear()

    const { run: fused, created } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: true,
      baseRef: 'develop',
    })

    expect(created).toBe(true)
    const fusion = fused.fusions[0]!
    expect(fusion.status).toBe('started')
    expect(fusion.model).toBe('openai/c')
    expect(fusion.sessionId).toBeTruthy()
    expect(fusion.directory).toBe('/worktrees/Sweep-fusion-1')
    expect(fusion.sources.map((source) => source.entryId)).toEqual(entryIds)
    expect(fusion.sources.map((source) => source.sessionId)).toEqual(sessionIds)
    expect(fusion.baseRef).toBe('develop')

    const fusionWorkspaceCall = repoWorkspaces.create.mock.calls.find(
      (call) => call[1].name === 'Sweep-fusion-1',
    )
    expect(fusionWorkspaceCall?.[1].ref).toBe('develop')

    const fusionPrompt = sessionPrompt.mock.calls.at(-1)![0].text
    expect(fusionPrompt).toContain('do the thing')
    expect(fusionPrompt).toContain('openai/a')
    expect(fusionPrompt).toContain('openai/b')
    expect(sessionCreate).toHaveBeenCalledTimes(1)

    expect(
      fused.entries.map((entry) => ({
        status: entry.status,
        sessionId: entry.sessionId,
        directory: entry.directory,
      })),
    ).toEqual(before)
  })

  it('grants read access to the selected source workspaces and denies edits when fusing', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b', 'openai/c'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds: [entryIds[0]!, entryIds[2]!],
      model: 'openai/d',
      isolate: true,
    })

    expect(sessionCreate).toHaveBeenCalledTimes(1)
    expect(sessionCreate.mock.calls[0]![0].permissions).toEqual([
      ...buildSchedulePermissionRuleset(null),
      { action: 'external_directory', resource: '/worktrees/Sweep-1/*', effect: 'allow' },
      { action: 'edit', resource: '/worktrees/Sweep-1/*', effect: 'deny' },
      { action: 'external_directory', resource: '/worktrees/Sweep-3/*', effect: 'allow' },
      { action: 'edit', resource: '/worktrees/Sweep-3/*', effect: 'deny' },
    ])
    const serializedPermissions = JSON.stringify(sessionCreate.mock.calls[0]![0].permissions)
    expect(serializedPermissions).not.toContain('Sweep-2')
    expect(serializedPermissions).not.toContain('Sweep-fusion-1')
  })

  it('stores the default auto mode on the fusion session', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    const permissionModes = new SessionPermissionModeService(db, client, settingsService)
    const service = createService(client, repoWorkspaces.service, permissionModes)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const { run: fused } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: false,
    })

    const fusionSessionId = fused.fusions[0]!.sessionId!
    expect(getSessionPermissionMode(db, fusionSessionId)).toBe('auto')
  })

  it('stores no mode on the fusion session when the default is ask', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const { run: fused } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: false,
    })

    const fusionSessionId = fused.fusions[0]!.sessionId!
    expect(getSessionPermissionMode(db, fusionSessionId)).toBeNull()
  })

  it('keeps the fusion started and logs when applying the default permission mode fails', async () => {
    const repoId = readyRepo()
    const { client } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const permissionModes = {
      applyDefaultMode: vi.fn(async () => {
        throw new Error('permission store unavailable')
      }),
    } as unknown as SessionPermissionModeService
    const service = createService(client, repoWorkspaces.service, permissionModes)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)

    const { run: fused } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: false,
    })

    const fusion = fused.fusions[0]!
    expect(fusion.status).toBe('started')
    expect(fusion.sessionId).not.toBeNull()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.stringContaining(fusion.sessionId!),
      expect.any(Error),
    )
  })

  it('returns the same fusion for a repeated requestId and launches once', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const request = { requestId: FUSE_REQUEST_ID, entryIds, model: 'openai/c', isolate: false }
    const first = await service.fuse(run.id, request)
    const second = await service.fuse(run.id, request)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.run.fusions).toHaveLength(1)
    expect(second.run.fusions[0]!.id).toBe(first.run.fusions[0]!.id)
    expect(second.run.fusions[0]!.sessionId).toBe(first.run.fusions[0]!.sessionId)
    expect(sessionCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects fusion when a selected result is still running', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient({ ses_2: { busy: true } })
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const error = await service
      .fuse(run.id, { requestId: FUSE_REQUEST_ID, entryIds, model: 'openai/c', isolate: false })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 409, code: 'FUSION_SOURCES_UNAVAILABLE' })
    expect((error as MultiRunError).details).toEqual({
      unavailableSources: [expect.objectContaining({ reason: 'running' })],
    })
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(service.list(repoId)[0]!.fusions).toEqual([])
  })

  it('rejects fusion when the prompt exceeds the context limit', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Huge',
      prompt: 'o'.repeat(60_000),
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const error = await service
      .fuse(run.id, { requestId: FUSE_REQUEST_ID, entryIds, model: 'openai/c', isolate: false })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FusionContextLimitError)
    expect(error).toMatchObject({ status: 413, code: 'FUSION_CONTEXT_LIMIT' })
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(service.list(repoId)[0]!.fusions).toEqual([])
  })

  it('rejects fusion with an unavailable synthesis model before creating a fusion', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const error = await service
      .fuse(run.id, { requestId: FUSE_REQUEST_ID, entryIds, model: 'openai/retired', isolate: false })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 400 })
    expect((error as Error).message).toContain('not available')
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(service.list(repoId)[0]!.fusions).toEqual([])
  })

  it('records a failed fusion with the workspace directory when the launch fails', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: false,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()
    sessionCreate.mockRejectedValueOnce(new Error('fusion boom'))

    const { run: fused, created } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: true,
    })

    expect(created).toBe(true)
    const fusion = fused.fusions[0]!
    expect(fusion.status).toBe('failed')
    expect(fusion.error).toContain('fusion boom')
    expect(fusion.directory).toBe('/worktrees/Sweep-fusion-1')
  })

  it('records the created session id on a failed fusion when the prompt is rejected', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate, sessionPrompt } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()
    sessionPrompt.mockRejectedValueOnce(new Error('prompt boom'))

    const { run: fused, created } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: false,
    })

    expect(created).toBe(true)
    const fusion = fused.fusions[0]!
    expect(fusion.status).toBe('failed')
    expect(fusion.error).toContain('prompt boom')
    expect(fusion.sessionId).toBe('ses_3')
    expect(sessionCreate).toHaveBeenCalledTimes(1)
  })

  it('recovers an uncertain fusion when the session already admitted the prompt', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate, sessionPrompt } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionPrompt.mockRejectedValueOnce(new Error('prompt boom'))

    const { run: firstFused } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: false,
    })
    const failedFusion = firstFused.fusions[0]!
    expect(failedFusion.status).toBe('failed')
    expect(failedFusion.sessionId).toBe('ses_3')

    sessionCreate.mockClear()

    const error = await service
      .fuse(run.id, {
        requestId: '22222222-2222-4222-8222-222222222222',
        entryIds,
        model: 'openai/c',
        isolate: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 409, code: 'FUSION_ATTEMPT_RECOVERED' })
    expect((error as MultiRunError).details).toEqual({
      fusions: [{ fusionId: failedFusion.id, sessionId: 'ses_3' }],
    })
    expect(sessionCreate).not.toHaveBeenCalled()

    const recovered = service.list(repoId)[0]!.fusions[0]!
    expect(recovered.status).toBe('started')
    expect(recovered.error).toBeNull()
  })

  it('proceeds with a new fusion when the failed attempt never admitted the prompt', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate, sessionPrompt } = createClient({ ses_3: { hasUserMessage: false } })
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: true,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionPrompt.mockRejectedValueOnce(new Error('prompt boom'))

    const { run: firstFused } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: false,
    })
    expect(firstFused.fusions[0]!.status).toBe('failed')

    sessionCreate.mockClear()

    const { run: fused, created } = await service.fuse(run.id, {
      requestId: '33333333-3333-4333-8333-333333333333',
      entryIds,
      model: 'openai/c',
      isolate: false,
    })

    expect(created).toBe(true)
    expect(sessionCreate).toHaveBeenCalledTimes(1)
    expect(fused.fusions.map((fusion) => fusion.status)).toEqual(['failed', 'started'])
  })

  it('rejects a non-isolated fusion when a selected result ran in the repository checkout', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: false,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const error = await service
      .fuse(run.id, {
        requestId: FUSE_REQUEST_ID,
        entryIds,
        model: 'openai/c',
        isolate: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 409, code: 'FUSION_DESTINATION_OVERLAPS_SOURCE' })
    expect((error as MultiRunError).details).toEqual({ entryIds })
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(service.list(repoId)[0]!.fusions).toEqual([])
  })

  it('allows an isolated fusion when the selected results ran in the repository checkout', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: false,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const { run: fused, created } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      isolate: true,
    })

    expect(created).toBe(true)
    expect(fused.fusions[0]!.status).toBe('started')
    expect(fused.fusions[0]!.directory).toBe('/worktrees/Sweep-fusion-1')
    expect(sessionCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects fusion with an entry id that does not belong to the run', async () => {
    const repoId = readyRepo()
    const { client, sessionCreate } = createClient()
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    const run = await service.launch({
      repoId,
      name: 'Sweep',
      prompt: 'go',
      models: ['openai/a', 'openai/b'],
      isolate: false,
    })
    const entryIds = run.entries.map((entry) => entry.id)
    sessionCreate.mockClear()

    const error = await service
      .fuse(run.id, {
        requestId: FUSE_REQUEST_ID,
        entryIds: [entryIds[0]!, 9999],
        model: 'openai/c',
        isolate: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MultiRunError)
    expect(error).toMatchObject({ status: 400 })
    expect((error as Error).message).toBe('Unknown multi-run entry 9999')
    expect(sessionCreate).not.toHaveBeenCalled()
    expect(service.list(repoId)[0]!.fusions).toEqual([])
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
    const repoWorkspaces = createRepoWorkspaces()
    const service = createService(client, repoWorkspaces.service)

    await service.launch({ repoId, name: 'Sweep', prompt: 'go', models: ['openai/a'], isolate: false })

    deleteRepo(db, repoId)

    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_runs').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM multi_run_entries').get()).toEqual({ count: 0 })
  })
})
