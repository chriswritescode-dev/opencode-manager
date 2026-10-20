import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getMultiRun } from '../../src/db/multi-runs'
import { MultiRunService } from '../../src/services/multi-runs'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { RepoWorkspaceService } from '../../src/services/repo-workspace'
import type { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import { assistantMessage } from '../helpers/stub-schedule-api'

const SERVER_ID = 'srv_kitchen'
const REMOTE_DIR = '/srv/projects/app'
const FUSE_REQUEST_ID = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  resolveOpenCodeModel: vi.fn(),
  existsSync: vi.fn(),
  executeCommand: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: mocks.resolveOpenCodeModel,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: mocks.existsSync }
})

vi.mock('../../src/utils/process', () => ({
  executeCommand: mocks.executeCommand,
}))

interface FakeRemoteClient {
  client: OpenCodeClient
  sessionCreate: ReturnType<typeof vi.fn>
  sessionPrompt: ReturnType<typeof vi.fn>
  locationGet: ReturnType<typeof vi.fn>
  worktreeCreate: ReturnType<typeof vi.fn>
  worktreeRemove: ReturnType<typeof vi.fn>
}

function createRemoteClient(options: { worktreeDirectory?: string } = {}): FakeRemoteClient {
  let sessionCounter = 0
  let worktreeCounter = 0

  const locationGet = vi.fn(async () => ({ project: { id: 'proj_remote' } }))
  const worktreeCreate = vi.fn(async () => {
    worktreeCounter += 1
    return { directory: options.worktreeDirectory ?? `/srv/worktrees/app-${worktreeCounter}` }
  })
  const worktreeRemove = vi.fn(async () => undefined)

  const sessionCreate = vi.fn(async (input: { title?: string }) => {
    sessionCounter += 1
    return { id: `ses_remote_${sessionCounter}`, title: input?.title }
  })
  const sessionPrompt = vi.fn(async () => ({}))
  const sessionGet = vi.fn(async ({ sessionID }: { sessionID: string }) => ({
    id: sessionID,
    outcome: 'succeeded',
  }))
  const sessionActive = vi.fn(async () => ({}))
  const sessionDiff = vi.fn(async () => [])
  const messageList = vi.fn(async (input: { sessionID: string; type?: string }) => {
    if (input.type === 'user') {
      return { data: [{ id: `${input.sessionID}-user`, type: 'user', time: { created: 0 }, text: 'hi' }], cursor: {} }
    }
    return { data: [assistantMessage('remote reply', { completed: true })], cursor: {} }
  })

  const client = {
    api: {
      location: { get: locationGet },
      worktree: { create: worktreeCreate, remove: worktreeRemove },
      session: {
        create: sessionCreate,
        prompt: sessionPrompt,
        get: sessionGet,
        active: sessionActive,
        diff: sessionDiff,
      },
      message: { list: messageList },
    },
  } as unknown as OpenCodeClient

  return { client, sessionCreate, sessionPrompt, locationGet, worktreeCreate, worktreeRemove }
}

describe('MultiRunService on a linked server', () => {
  let db: Database
  let localClient: OpenCodeClient
  let localSessionCreate: ReturnType<typeof vi.fn>
  let repoWorkspaces: { create: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
  let applyDefaultMode: ReturnType<typeof vi.fn>
  let remote: FakeRemoteClient

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    migrate(db, allMigrations)

    localSessionCreate = vi.fn(async () => ({ id: 'ses_local' }))
    localClient = {
      api: {
        session: { create: localSessionCreate, prompt: vi.fn(), get: vi.fn(), active: vi.fn(), diff: vi.fn() },
        message: { list: vi.fn() },
      },
    } as unknown as OpenCodeClient

    repoWorkspaces = { create: vi.fn(), remove: vi.fn() }
    applyDefaultMode = vi.fn(async () => undefined)
    remote = createRemoteClient()

    mocks.resolveOpenCodeModel.mockImplementation(async (_client, directory, options) => {
      const preferred = options?.preferredModel
      if (!preferred) {
        return { providerID: 'openai', id: 'gpt-5', model: 'openai/gpt-5', directory }
      }
      if (preferred === 'openai/retired') {
        return { providerID: 'openai', id: 'retired-x', model: 'openai/retired-x' }
      }
      const [providerID, ...rest] = preferred.split('/')
      return { providerID, id: rest.join('/'), model: preferred }
    })
  })

  afterEach(() => {
    db.close()
  })

  function createService(): MultiRunService {
    const permissionModes = { applyDefaultMode } as unknown as SessionPermissionModeService

    return new MultiRunService(
      db,
      localClient,
      repoWorkspaces as unknown as RepoWorkspaceService,
      permissionModes,
      () => remote.client,
    )
  }

  function launchRemote(overrides: Record<string, unknown> = {}) {
    return createService().launch({
      serverId: SERVER_ID,
      directory: REMOTE_DIR,
      name: 'Remote sweep',
      prompt: 'go',
      models: ['openai/a'],
      isolate: true,
      ...overrides,
    })
  }

  it('launches every model through the remote client and remote worktrees', async () => {
    const run = await launchRemote({ models: ['openai/a', 'openai/b'], baseRef: 'develop' })

    expect(run).toMatchObject({
      repoId: null,
      serverId: SERVER_ID,
      directory: REMOTE_DIR,
      name: 'Remote sweep',
      isolated: true,
    })
    expect(run.entries.map((entry) => entry.status)).toEqual(['started', 'started'])
    expect(run.entries.map((entry) => entry.directory)).toEqual([
      '/srv/worktrees/app-1',
      '/srv/worktrees/app-2',
    ])

    expect(remote.locationGet).toHaveBeenCalledWith({ location: { directory: REMOTE_DIR } })
    expect(remote.worktreeCreate).toHaveBeenCalledTimes(2)
    expect(remote.worktreeCreate).toHaveBeenCalledWith({
      projectID: 'proj_remote',
      name: 'Remote-sweep-1',
      branch: 'develop',
    })
    expect(remote.sessionCreate).toHaveBeenCalledTimes(2)
    expect(remote.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ location: { directory: '/srv/worktrees/app-1' } }),
    )
    expect(remote.sessionPrompt).toHaveBeenCalledWith({ sessionID: 'ses_remote_1', text: 'go' })

    expect(localSessionCreate).not.toHaveBeenCalled()
    expect(repoWorkspaces.create).not.toHaveBeenCalled()
    expect(mocks.existsSync).not.toHaveBeenCalled()
    expect(mocks.executeCommand).not.toHaveBeenCalled()
    expect(mocks.resolveOpenCodeModel).toHaveBeenCalledWith(remote.client, REMOTE_DIR, { preferredModel: 'openai/a' })
  })

  it('runs in the target directory without a worktree when isolation is off', async () => {
    const run = await launchRemote({ isolate: false })

    expect(run.entries[0]!.directory).toBe(REMOTE_DIR)
    expect(remote.worktreeCreate).not.toHaveBeenCalled()
    expect(remote.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ location: { directory: REMOTE_DIR } }),
    )
  })

  it('fails an entry whose model the remote catalog does not offer', async () => {
    const run = await launchRemote({ models: ['openai/a', 'openai/retired'] })

    expect(run.entries.map((entry) => entry.status)).toEqual(['started', 'failed'])
    expect(run.entries[1]!.error).toBe('Model openai/retired is not available')
    expect(remote.worktreeCreate).toHaveBeenCalledTimes(1)
  })

  it('lists remote runs by server and directory without mixing in repository runs', async () => {
    const service = createService()
    await launchRemote({ name: 'Remote one' })

    expect(service.list({ kind: 'server', serverId: SERVER_ID, directory: REMOTE_DIR }).map((run) => run.name)).toEqual([
      'Remote one',
    ])
    expect(service.list({ kind: 'server', serverId: SERVER_ID, directory: '/srv/other' })).toEqual([])
    expect(service.list({ kind: 'repo', repoId: 1 })).toEqual([])
  })

  it('removes a remote worktree on discard without touching the local filesystem', async () => {
    const service = createService()
    const run = await launchRemote()
    const entry = run.entries[0]!

    const discarded = await service.discard(run.id, entry.id)

    expect(discarded.entries[0]!.status).toBe('discarded')
    expect(remote.worktreeRemove).toHaveBeenCalledWith({
      projectID: 'proj_remote',
      directory: '/srv/worktrees/app-1',
      force: true,
    })
    expect(mocks.existsSync).not.toHaveBeenCalled()
    expect(repoWorkspaces.remove).not.toHaveBeenCalled()
    expect(mocks.executeCommand).not.toHaveBeenCalled()
  })

  it('keeps a remote entry retryable when worktree removal fails', async () => {
    const service = createService()
    const run = await launchRemote()
    remote.worktreeRemove.mockRejectedValueOnce(new Error('worktree busy'))

    const error = await service.discard(run.id, run.entries[0]!.id).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ status: 502 })
    expect(service.list({ kind: 'server', serverId: SERVER_ID, directory: REMOTE_DIR })[0]!.entries[0]!.status).toBe(
      'started',
    )
  })

  it('fuses remote results in a remote worktree and reads sources from the remote client', async () => {
    const service = createService()
    const run = await launchRemote({ models: ['openai/a', 'openai/b'] })
    const entryIds = run.entries.map((entry) => entry.id)
    remote.sessionCreate.mockClear()

    const { run: fused, created } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds,
      model: 'openai/c',
      baseRef: 'develop',
    })

    expect(created).toBe(true)
    const fusion = fused.fusions[0]!
    expect(fusion.status).toBe('started')
    expect(fusion.directory).toBe('/srv/worktrees/app-3')
    expect(fusion.sources.map((source) => source.sessionId)).toEqual(['ses_remote_1', 'ses_remote_2'])

    expect(remote.worktreeCreate).toHaveBeenLastCalledWith({
      projectID: 'proj_remote',
      name: 'Remote-sweep-fusion-1',
      branch: 'develop',
    })
    expect(remote.sessionCreate).toHaveBeenCalledTimes(1)
    expect(remote.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { directory: '/srv/worktrees/app-3' },
        permissions: [
          ...buildSchedulePermissionRuleset(null),
          { action: 'external_directory', resource: '/srv/worktrees/app-1/*', effect: 'allow' },
          { action: 'edit', resource: '/srv/worktrees/app-1/*', effect: 'deny' },
          { action: 'external_directory', resource: '/srv/worktrees/app-2/*', effect: 'allow' },
          { action: 'edit', resource: '/srv/worktrees/app-2/*', effect: 'deny' },
        ],
      }),
    )
    expect(localSessionCreate).not.toHaveBeenCalled()
    expect(repoWorkspaces.create).not.toHaveBeenCalled()
    expect(applyDefaultMode).toHaveBeenCalledWith('ses_remote_3', '/srv/worktrees/app-3', 'srv_kitchen')
  })

  it('records a failed remote fusion without a local fallback', async () => {
    const service = createService()
    const run = await launchRemote({ models: ['openai/a', 'openai/b'] })
    remote.sessionCreate.mockRejectedValueOnce(new Error('remote boom'))

    const { run: fused } = await service.fuse(run.id, {
      requestId: FUSE_REQUEST_ID,
      entryIds: run.entries.map((entry) => entry.id),
      model: 'openai/c',
    })

    expect(fused.fusions[0]!.status).toBe('failed')
    expect(fused.fusions[0]!.error).toContain('remote boom')
    expect(fused.fusions[0]!.directory).toBe('/srv/worktrees/app-3')
    expect(localSessionCreate).not.toHaveBeenCalled()
  })

  it('persists the server target on the run row', async () => {
    const run = await launchRemote()

    expect(getMultiRun(db, run.id)).toMatchObject({
      repoId: null,
      serverId: SERVER_ID,
      directory: REMOTE_DIR,
    })
  })
})
