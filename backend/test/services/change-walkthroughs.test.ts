import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import type { FileDiffInfo, ModelInfo, SessionInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { WALKTHROUGH_GENERATION_TIMEOUT_MS, type SchedulePermissionRule } from '@opencode-manager/shared/schemas'
import {
  claimChangeWalkthroughGeneration,
  getChangeWalkthrough,
  updateChangeWalkthrough,
} from '../../src/db/change-walkthroughs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { SettingsService } from '../../src/services/settings'
import type { GitService } from '../../src/services/git/GitService'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import { stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { createCommittedRepo, createGitAuthService, createOrigin, cloneOrigin, git, uniqueName } from '../helpers/git-fixtures'
import {
  ChangeWalkthroughService,
  buildWalkthroughSessionPermissions,
  buildWalkthroughSessionPrompt,
} from '../../src/services/change-walkthroughs'
import { computeChangesHash } from '../../src/services/walkthrough-outline'

const SESSION_ID = 'ses_walkthrough'

function userMessage(id: string): SessionMessageInfo {
  return { id, type: 'user', time: { created: 0 }, text: id } as SessionMessageInfo
}

function change(file: string, patch: string, status: FileDiffInfo['status'] = 'modified'): FileDiffInfo {
  return { file, patch, additions: 1, deletions: 1, status }
}

function hunkPatch(line: number): string {
  return `@@ -${line},2 +${line},2 @@\n-const a${line} = 1;\n+const a${line} = 2;`
}

const THREE_HUNKS: FileDiffInfo[] = [
  change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
  change('src/b.ts', hunkPatch(1)),
]

interface FakeSession {
  info?: SessionInfo | Error
  changes?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const createCalls: Array<Record<string, unknown>> = []
  const promptCalls: Array<{ sessionID: string; text: string }> = []
  const interruptCalls: string[] = []
  let createSeq = 0
  let createImpl: (input: Record<string, unknown>) => Promise<{ id: string; title?: string }> = async () => ({
    id: `ses_walk_${++createSeq}`,
  })

  const client = {
    api: {
      ...stubLoadedModelCatalog([
        { providerID: 'openai', id: 'gpt-5-mini', enabled: true },
        { providerID: 'anthropic', id: 'claude-sonnet-4', enabled: true },
        { providerID: 'openai', id: 'gpt-5', enabled: true },
      ] as ModelInfo[]),
      session: {
        get: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          const config = sessions[sessionID]
          if (!config) {
            throw Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
          }
          if (config.info instanceof Error) {
            throw config.info
          }
          return config.info ?? ({
            id: sessionID,
            title: `Title ${sessionID}`,
            location: { directory: '/abs/repo' },
          } as SessionInfo)
        }),
        diff: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          const config = sessions[sessionID]
          if (config?.changes instanceof Error) {
            throw config.changes
          }
          return config?.changes ?? []
        }),
        create: vi.fn(async (input: Record<string, unknown>) => {
          createCalls.push(input)
          return createImpl(input)
        }),
        prompt: vi.fn(async (input: { sessionID: string; text: string }) => {
          promptCalls.push(input)
        }),
        interrupt: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          interruptCalls.push(sessionID)
        }),
      },
      message: {
        list: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          if (!sessions[sessionID]) {
            return { data: [], cursor: {} }
          }
          return { data: [userMessage('msg-1')], cursor: {} }
        }),
      },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return {
    client,
    createCalls,
    promptCalls,
    interruptCalls,
    setCreateImpl: (impl: (input: Record<string, unknown>) => Promise<{ id: string; title?: string }>) => {
      createImpl = impl
    },
  }
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function sessionEvent(type: string, sessionID: string): SSEEvent {
  return {
    id: `evt_${type}_${sessionID}`,
    created: Date.now(),
    type,
    location: { directory: '/abs/repo' },
    data: { sessionID },
  } as unknown as SSEEvent
}

const walkthroughRepoRoot = mkdtempSync(path.join(tmpdir(), 'walkthrough-service-'))
const walkthroughsRoot = mkdtempSync(path.join(tmpdir(), 'walkthroughs-root-'))

afterAll(() => {
  rmSync(walkthroughRepoRoot, { recursive: true, force: true })
  rmSync(walkthroughsRoot, { recursive: true, force: true })
})

function createChangedRepo(): string {
  const repo = path.join(walkthroughRepoRoot, uniqueName('repo'))
  createCommittedRepo(repo)
  writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  git(['add', 'a.txt'], repo)
  git(['commit', '-m', 'add a'], repo)
  writeFileSync(path.join(repo, 'a.txt'), 'two\n')
  return repo
}

function createPullRequestRepo(): string {
  const origin = path.join(walkthroughRepoRoot, uniqueName('pr-origin'))
  const work = path.join(walkthroughRepoRoot, uniqueName('pr-work'))
  const clone = path.join(walkthroughRepoRoot, uniqueName('pr-clone'))
  createOrigin(origin, work)
  cloneOrigin(origin, clone)
  writeFileSync(path.join(clone, 'pr.txt'), 'pr\n')
  git(['add', 'pr.txt'], clone)
  git(['commit', '-m', 'pr'], clone)
  git(['push', 'origin', 'HEAD:refs/pull/1/head'], clone)
  return clone
}

function refExists(repo: string, ref: string): boolean {
  try {
    git(['rev-parse', '--verify', ref], repo)
    return true
  } catch {
    return false
  }
}

function sessionAt(directory: string, id: string = SESSION_ID): SessionInfo {
  return { id, title: 'Title', location: { directory } } as SessionInfo
}

function outputDirFromPermissions(permissions: SchedulePermissionRule[]): string {
  const rule = permissions.at(-2)!
  return rule.resource.slice(0, -'/*'.length)
}

function artifactPathFor(call: Record<string, unknown>): string {
  const outputDir = outputDirFromPermissions(call.permissions as SchedulePermissionRule[])
  return path.join(outputDir, 'index.html')
}

function writeArtifact(call: Record<string, unknown>): string {
  const artifactPath = artifactPathFor(call)
  writeFileSync(artifactPath, '<html><body>walkthrough</body></html>')
  return artifactPath
}

describe('buildWalkthroughSessionPermissions', () => {
  it('denies edits everywhere, allows the output directory, and keeps the unattended baseline', () => {
    const ruleset = buildWalkthroughSessionPermissions('/tmp/out/dir')

    expect(ruleset).toContainEqual({ action: 'edit', resource: '*', effect: 'deny' })
    expect(ruleset).toContainEqual({ action: 'external_directory', resource: '*', effect: 'deny' })
    expect(ruleset.at(-2)).toEqual({ action: 'external_directory', resource: '/tmp/out/dir/*', effect: 'allow' })
    expect(ruleset.at(-1)).toEqual({ action: 'edit', resource: '/tmp/out/dir/*', effect: 'allow' })
  })

  it('normalizes the output directory', () => {
    const ruleset = buildWalkthroughSessionPermissions('/tmp/out/../out/dir/')

    expect(ruleset.at(-2)!.resource).toBe('/tmp/out/dir/*')
  })
})

describe('buildWalkthroughSessionPrompt', () => {
  it('states the role, the data actions, the reading order and the output file', () => {
    const prompt = buildWalkthroughSessionPrompt({
      title: 'My session',
      sourceDescription: 'the changes in this session',
      artifactPath: '/tmp/walkthroughs/ses_1/gen/index.html',
    })

    expect(prompt).toContain('My session')
    expect(prompt).toContain('the changes in this session')
    expect(prompt).toContain('walkthrough_changes')
    expect(prompt).toContain('publish_walkthrough')
    expect(prompt).toContain('contracts and data model first')
    expect(prompt).toContain('self-contained HTML file')
    expect(prompt).toContain('/tmp/walkthroughs/ses_1/gen/index.html')
  })
})

describe('ChangeWalkthroughService', () => {
  let db: Database
  let sessions: Record<string, FakeSession>
  let fake: ReturnType<typeof createFakeClient>
  let service: ChangeWalkthroughService
  let gitService: GitService
  let fetchRemoteRef: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = createTestDb()
    sessions = { [SESSION_ID]: { changes: THREE_HUNKS, info: sessionAt('/abs/repo') } }
    fake = createFakeClient(sessions)
    fetchRemoteRef = vi.fn(async () => {})
    gitService = { fetchRemoteRef } as unknown as GitService
    service = new ChangeWalkthroughService(db, fake.client, new SettingsService(db), createGitAuthService(), gitService, {
      walkthroughsRoot,
    })
  })

  afterEach(() => {
    db.close()
  })

  it('throws 404 for a missing session on GET', async () => {
    await expect(service.getState('ses_missing')).rejects.toMatchObject({ status: 404 })
  })

  it('reports no walkthrough and a current hash on GET', async () => {
    const state = await service.getState(SESSION_ID)

    expect(state.walkthrough).toBeNull()
    expect(state.stale).toBe(false)
    expect(state.currentDiffHash).toBe(computeChangesHash(THREE_HUNKS))
    expect(state.generating).toBe(false)
    expect(state.error).toBeNull()
  })

  it('creates exactly one walkthrough session and returns generating', async () => {
    const state = await service.startGeneration(SESSION_ID, {})

    expect(fake.createCalls).toHaveLength(1)
    const created = fake.createCalls[0]!
    expect(created.title).toBe('Walkthrough · Title')
    expect(created.model).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
    expect(created.location).toEqual({ directory: '/abs/repo' })

    const permissions = created.permissions as SchedulePermissionRule[]
    const outputDir = outputDirFromPermissions(permissions)
    expect(outputDir.startsWith(path.join(walkthroughsRoot, SESSION_ID))).toBe(true)
    expect(existsSync(outputDir)).toBe(true)

    expect(fake.promptCalls).toHaveLength(1)
    expect(fake.promptCalls[0]!.sessionID).toBe('ses_walk_1')
    expect(fake.promptCalls[0]!.text).toContain(path.join(outputDir, 'index.html'))

    expect(state.generating).toBe(true)
    expect(state.walkthrough?.status).toBe('generating')
    expect(state.walkthrough?.walkthroughSessionId).toBe('ses_walk_1')
    expect(state.walkthrough?.artifactPath).toBe(path.join(outputDir, 'index.html'))
  })

  it('uses the source description in the session title for a git source', async () => {
    const repo = createChangedRepo()
    sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }

    await service.startGeneration(SESSION_ID, { source: { kind: 'uncommitted' } })

    expect(fake.createCalls[0]!.title).toBe('Walkthrough · Title — uncommitted changes')
  })

  it('does not create another session while one is generating', async () => {
    await service.startGeneration(SESSION_ID, {})
    const second = await service.startGeneration(SESSION_ID, {})

    expect(fake.createCalls).toHaveLength(1)
    expect(second.generating).toBe(true)
  })

  it('returns the ready record without a new session when the diff is unchanged', async () => {
    await service.startGeneration(SESSION_ID, {})
    updateChangeWalkthrough(db, SESSION_ID, 'session', ['generating'], {
      status: 'ready',
      publishedAt: 1,
      updatedAt: Date.now(),
    })

    const state = await service.startGeneration(SESSION_ID, {})

    expect(fake.createCalls).toHaveLength(1)
    expect(state.generating).toBe(false)
    expect(state.walkthrough?.status).toBe('ready')
  })

  it('spawns a new session and generation directory when regenerate is set', async () => {
    await service.startGeneration(SESSION_ID, {})
    const firstDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
    updateChangeWalkthrough(db, SESSION_ID, 'session', ['generating'], {
      status: 'ready',
      publishedAt: 1,
      updatedAt: Date.now(),
    })

    await service.startGeneration(SESSION_ID, { regenerate: true })

    expect(fake.createCalls).toHaveLength(2)
    const secondDir = outputDirFromPermissions(fake.createCalls[1]!.permissions as SchedulePermissionRule[])
    expect(secondDir).not.toBe(firstDir)
    expect(existsSync(secondDir)).toBe(true)
  })

  it('spawns a new session when the diff changed', async () => {
    await service.startGeneration(SESSION_ID, {})
    updateChangeWalkthrough(db, SESSION_ID, 'session', ['generating'], {
      status: 'ready',
      publishedAt: 1,
      updatedAt: Date.now(),
    })
    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]

    await service.startGeneration(SESSION_ID, {})

    expect(fake.createCalls).toHaveLength(2)
  })

  it('rejects with 409 and creates no session when there are no changes', async () => {
    sessions[SESSION_ID]!.changes = []

    await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({
      status: 409,
      code: 'WALKTHROUGH_NO_CHANGES',
    })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('rejects with 409 and creates no session when there are no text changes', async () => {
    sessions[SESSION_ID]!.changes = [
      change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
    ]

    await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({
      status: 409,
      code: 'WALKTHROUGH_NO_TEXT_CHANGES',
    })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('marks the record failed when session.create fails and reports the error', async () => {
    fake.setCreateImpl(async () => {
      throw new Error('create failed')
    })

    await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({
      status: 502,
      code: 'WALKTHROUGH_SESSION_START_FAILED',
    })

    const state = await service.getState(SESSION_ID)
    expect(state.generating).toBe(false)
    expect(state.error).toMatchObject({ message: 'create failed' })
  })

  it('marks the record failed when the prompt fails and reports the error', async () => {
    vi.mocked(fake.client.api.session.prompt).mockRejectedValueOnce(new Error('prompt failed'))

    await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({
      status: 502,
      code: 'WALKTHROUGH_SESSION_START_FAILED',
    })

    const state = await service.getState(SESSION_ID)
    expect(state.walkthrough?.status).toBe('failed')
    expect(state.error).toMatchObject({ message: 'prompt failed' })
  })

  it('removes the generation directory and interrupts the session when the prompt fails', async () => {
    vi.mocked(fake.client.api.session.prompt).mockRejectedValueOnce(new Error('prompt failed'))

    await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({ status: 502 })

    const outputDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
    expect(existsSync(outputDir)).toBe(false)
    expect(fake.interruptCalls).toContain('ses_walk_1')
  })

  it('rejects with 502 when reading changes fails', async () => {
    sessions[SESSION_ID]!.changes = new Error('diff failed')

    await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({
      status: 502,
      code: 'WALKTHROUGH_CHANGES_UNAVAILABLE',
    })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('resolves the walkthrough model preference over the request and session model', async () => {
    new SettingsService(db).updateSettings({ walkthroughModel: 'openai/gpt-5' })
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      location: { directory: '/abs/repo' },
    } as SessionInfo

    await service.startGeneration(SESSION_ID, { model: 'openai/gpt-5-mini' })

    expect(fake.createCalls[0]!.model).toEqual({ providerID: 'openai', id: 'gpt-5' })
  })

  it('uses the request model over the session model', async () => {
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      location: { directory: '/abs/repo' },
    } as SessionInfo

    await service.startGeneration(SESSION_ID, { model: 'openai/gpt-5-mini' })

    expect(fake.createCalls[0]!.model).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('caches the current hash until a session execution event', async () => {
    await service.getState(SESSION_ID)
    await service.getState(SESSION_ID)

    expect(vi.mocked(fake.client.api.session.diff)).toHaveBeenCalledTimes(1)
  })

  it('recomputes the hash after session.execution.succeeded and reports stale', async () => {
    await service.startGeneration(SESSION_ID, {})

    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]
    const cached = await service.getState(SESSION_ID)
    expect(cached.stale).toBe(false)

    service.handleEvent(sessionEvent('session.execution.succeeded', SESSION_ID))

    const refreshed = await service.getState(SESSION_ID)
    expect(refreshed.stale).toBe(true)
    expect(refreshed.currentDiffHash).toBe(computeChangesHash([change('src/a.ts', hunkPatch(99))]))
  })

  it('reports a null current hash when changes cannot be read', async () => {
    sessions[SESSION_ID]!.changes = new Error('diff failed')

    const state = await service.getState(SESSION_ID)
    expect(state.currentDiffHash).toBeNull()
    expect(state.stale).toBe(false)
  })

  it('cancels a generating walkthrough and interrupts its session', async () => {
    await service.startGeneration(SESSION_ID, {})

    expect(await service.cancelGeneration(SESSION_ID)).toBe(true)

    const state = await service.getState(SESSION_ID)
    expect(state.generating).toBe(false)
    expect(state.walkthrough?.status).toBe('cancelled')
    expect(fake.interruptCalls).toContain('ses_walk_1')
  })

  it('returns false from cancel when nothing is generating', async () => {
    expect(await service.cancelGeneration(SESSION_ID)).toBe(false)
  })

  it('expires a generating record older than the timeout on read', async () => {
    const shortTimeout = new ChangeWalkthroughService(
      db,
      fake.client,
      new SettingsService(db),
      createGitAuthService(),
      gitService,
      { walkthroughsRoot, generationTimeoutMs: 50 },
    )
    await shortTimeout.startGeneration(SESSION_ID, {})
    updateChangeWalkthrough(db, SESSION_ID, 'session', ['generating'], {
      updatedAt: Date.now() - 10_000,
    })

    const state = await shortTimeout.getState(SESSION_ID)

    expect(state.generating).toBe(false)
    expect(state.error).toMatchObject({ code: 'WALKTHROUGH_TIMEOUT' })
    await vi.waitFor(() => expect(fake.interruptCalls).toContain('ses_walk_1'))
  })

  describe('per-source storage', () => {
    it('stores walkthroughs per source', async () => {
      const repo = createChangedRepo()
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }

      await service.startGeneration(SESSION_ID, {})
      await service.startGeneration(SESSION_ID, { source: { kind: 'uncommitted' } })

      const sessionStored = getChangeWalkthrough(db, SESSION_ID, 'session')
      const uncommittedStored = getChangeWalkthrough(db, SESSION_ID, 'uncommitted')
      expect(sessionStored).not.toBeNull()
      expect(uncommittedStored).not.toBeNull()
      expect(uncommittedStored!.source).toEqual({ kind: 'uncommitted' })
    })

    it('deletes every source when the session is deleted', async () => {
      const repo = createChangedRepo()
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }

      await service.startGeneration(SESSION_ID, {})
      await service.startGeneration(SESSION_ID, { source: { kind: 'uncommitted' } })

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      expect(getChangeWalkthrough(db, SESSION_ID, 'session')).toBeNull()
      expect(getChangeWalkthrough(db, SESSION_ID, 'uncommitted')).toBeNull()
    })
  })

  describe('pull request sources', () => {
    it('fetches the refs during generation and deletes them with the session', async () => {
      const repo = createPullRequestRepo()
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }
      fetchRemoteRef.mockImplementation(async (target: { fullPath: string }, remote: string, refspecs: string[]) => {
        git(['fetch', remote, ...refspecs], target.fullPath)
      })

      const headRef = `refs/ocm-walkthrough/${SESSION_ID}/pr/1/head`
      const baseRef = `refs/ocm-walkthrough/${SESSION_ID}/pr/1/base/main`

      await service.startGeneration(SESSION_ID, { source: { kind: 'pullRequest', number: 1, base: 'main' } })

      expect(fetchRemoteRef).toHaveBeenCalledTimes(1)
      expect(refExists(repo, headRef)).toBe(true)
      expect(refExists(repo, baseRef)).toBe(true)

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      await vi.waitFor(() => {
        expect(refExists(repo, headRef)).toBe(false)
        expect(refExists(repo, baseRef)).toBe(false)
      })
    })
  })

  it('clears the cached hash and its epoch when the session is deleted', async () => {
    await service.startGeneration(SESSION_ID, {})
    await service.getState(SESSION_ID)

    const internals = service as unknown as {
      currentHashes: Map<string, string>
      hashEpochs: Map<string, number>
    }
    expect(internals.currentHashes.size).toBeGreaterThan(0)

    service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

    expect(internals.currentHashes.size).toBe(0)
    expect(internals.hashEpochs.size).toBe(0)
  })

  it('drops a hash read that completes after the session is deleted', async () => {
    const diffMock = vi.mocked(fake.client.api.session.diff)
    let resolveDiff: (changes: FileDiffInfo[]) => void = () => {}
    diffMock.mockImplementationOnce(() => new Promise<FileDiffInfo[]>((resolve) => {
      resolveDiff = resolve
    }))

    const pending = service.getState(SESSION_ID)
    await vi.waitFor(() => expect(diffMock).toHaveBeenCalledTimes(1))

    service.handleEvent(sessionEvent('session.deleted', SESSION_ID))
    resolveDiff(THREE_HUNKS)
    await pending

    const internals = service as unknown as {
      currentHashes: Map<string, string>
      hashEpochs: Map<string, number>
      pendingHashReads: Map<string, number>
    }
    expect(internals.currentHashes.size).toBe(0)
    expect(internals.hashEpochs.size).toBe(0)
    expect(internals.pendingHashReads.size).toBe(0)
  })

  describe('walkthrough session lifecycle', () => {
    it('rejects a publish before the artifact exists and keeps generating', async () => {
      await service.startGeneration(SESSION_ID, {})

      await expect(service.publishFromWalkthroughSession('ses_walk_1')).rejects.toMatchObject({ status: 404 })

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('generating')
    })

    it('publishes an existing artifact and reports ready with the artifact path', async () => {
      await service.startGeneration(SESSION_ID, {})
      const artifactPath = writeArtifact(fake.createCalls[0]!)

      const result = await service.publishFromWalkthroughSession('ses_walk_1')

      expect(result.path).toBe(artifactPath)
      const state = await service.getState(SESSION_ID)
      expect(state.generating).toBe(false)
      expect(state.walkthrough?.status).toBe('ready')
      expect(state.walkthrough?.publishedAt).not.toBeNull()
      expect(state.walkthrough?.artifactPath).toBe(artifactPath)
    })

    it('rejects a publish for an unknown walkthrough session', async () => {
      await expect(service.publishFromWalkthroughSession('ses_other')).rejects.toMatchObject({
        status: 404,
        code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
      })
    })

    it('rejects a publish for a cancelled walkthrough', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.cancelGeneration(SESSION_ID)

      await expect(service.publishFromWalkthroughSession('ses_walk_1')).rejects.toMatchObject({
        status: 409,
        code: 'WALKTHROUGH_SUPERSEDED',
      })
    })

    it('rejects a publish from an old walkthrough session when a regenerate claims the record mid-flight', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)

      const publish = service.publishFromWalkthroughSession('ses_walk_1')
      expect(
        claimChangeWalkthroughGeneration(db, {
          sessionId: SESSION_ID,
          source: { kind: 'session' },
          diffHash: 'hash-new',
          generationId: 'gen-new',
          artifactPath: '/workspace/walkthroughs/gen-new/index.html',
          model: null,
          now: Date.now() + WALKTHROUGH_GENERATION_TIMEOUT_MS + 1,
        }),
      ).toBe(true)

      await expect(publish).rejects.toMatchObject({ status: 409, code: 'WALKTHROUGH_SUPERSEDED' })

      const row = getChangeWalkthrough(db, SESSION_ID, 'session')
      expect(row?.status).toBe('generating')
      expect(row?.walkthroughSessionId).toBeNull()
    })

    it('interrupts the previous walkthrough session when regenerating a ready walkthrough', async () => {
      await service.startGeneration(SESSION_ID, {})
      const firstDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
      updateChangeWalkthrough(db, SESSION_ID, 'session', ['generating'], {
        status: 'ready',
        publishedAt: 1,
        updatedAt: Date.now(),
      })

      await service.startGeneration(SESSION_ID, { regenerate: true })

      expect(fake.createCalls).toHaveLength(2)
      expect(fake.interruptCalls).toContain('ses_walk_1')
      expect(existsSync(firstDir)).toBe(false)
    })

    it('cancels a generation interrupted before the walkthrough session is recorded', async () => {
      let resolveCreate: (session: { id: string }) => void = () => {}
      fake.setCreateImpl(() => new Promise((resolve) => {
        resolveCreate = resolve
      }))

      const starting = service.startGeneration(SESSION_ID, {})
      await vi.waitFor(() => expect(fake.createCalls).toHaveLength(1))

      expect(await service.cancelGeneration(SESSION_ID)).toBe(true)

      resolveCreate({ id: 'ses_walk_late' })
      await starting

      expect(fake.promptCalls).toHaveLength(0)
      expect(fake.interruptCalls).toContain('ses_walk_late')
      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('cancelled')
    })

    it('keeps the cancelled status when the interrupt event arrives during cancel', async () => {
      await service.startGeneration(SESSION_ID, {})
      vi.mocked(fake.client.api.session.interrupt).mockImplementation(async ({ sessionID }) => {
        service.handleEvent(sessionEvent('session.execution.interrupted', sessionID))
        return { interrupted: true }
      })

      expect(await service.cancelGeneration(SESSION_ID)).toBe(true)

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('cancelled')
      expect(state.error).toBeNull()
    })

    it('restores the previous status when the refine prompt fails', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')
      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))

      vi.mocked(fake.client.api.session.prompt).mockRejectedValueOnce(new Error('prompt failed'))

      await expect(service.refine(SESSION_ID, { text: 'more' })).rejects.toMatchObject({ status: 502 })

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('ready')
      expect(state.generating).toBe(false)
      expect(state.running).toBe(false)
    })

    it('marks failed when the walkthrough session finishes without publishing', async () => {
      await service.startGeneration(SESSION_ID, {})

      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('failed')
      expect(state.error).toMatchObject({ code: 'WALKTHROUGH_NOT_PUBLISHED' })
    })

    it('keeps ready when the walkthrough session finishes after publishing', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')

      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('ready')
      expect(state.error).toBeNull()
      expect(state.running).toBe(false)
    })

    it('keeps the agent running after publishing and lets the timer settle it', async () => {
      vi.useFakeTimers()
      try {
        const timed = new ChangeWalkthroughService(
          db,
          fake.client,
          new SettingsService(db),
          createGitAuthService(),
          gitService,
          { walkthroughsRoot, generationTimeoutMs: 1000 },
        )
        await timed.startGeneration(SESSION_ID, {})
        writeArtifact(fake.createCalls[0]!)

        await timed.publishFromWalkthroughSession('ses_walk_1')

        const published = await timed.getState(SESSION_ID)
        expect(published.walkthrough?.status).toBe('ready')
        expect(published.generating).toBe(false)
        expect(published.running).toBe(true)

        await vi.advanceTimersByTimeAsync(1000)

        const settled = await timed.getState(SESSION_ID)
        expect(settled.walkthrough?.status).toBe('ready')
        expect(settled.generating).toBe(false)
        expect(settled.running).toBe(false)
        expect(fake.interruptCalls).toContain('ses_walk_1')
      } finally {
        vi.useRealTimers()
      }
    })

    it('cancels a published walkthrough that is still running', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')

      expect(await service.cancelGeneration(SESSION_ID)).toBe(true)

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('ready')
      expect(state.generating).toBe(false)
      expect(state.running).toBe(false)
      expect(fake.interruptCalls).toContain('ses_walk_1')
    })

    it('rejects a refine while the agent is still running after publishing', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')

      await expect(service.refine(SESSION_ID, { text: 'more' })).rejects.toMatchObject({
        status: 409,
        code: 'WALKTHROUGH_BUSY',
      })
    })

    it('interrupts a published walkthrough session when the target session is deleted', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')
      const before = fake.interruptCalls.length

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      expect(fake.interruptCalls).toHaveLength(before + 1)
      expect(fake.interruptCalls).toContain('ses_walk_1')
    })

    it('reuses the changes snapshot during a run and re-reads after refine', async () => {
      await service.startGeneration(SESSION_ID, {})
      const diffMock = vi.mocked(fake.client.api.session.diff)
      expect(diffMock).toHaveBeenCalledTimes(1)

      await service.readChangesForWalkthroughSession('ses_walk_1')
      await service.readChangesForWalkthroughSession('ses_walk_1', 'src/a.ts')
      expect(diffMock).toHaveBeenCalledTimes(1)

      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))
      await service.refine(SESSION_ID, { text: 'more' })

      await service.readChangesForWalkthroughSession('ses_walk_1')
      expect(diffMock).toHaveBeenCalledTimes(2)
    })

    it('does not retain a changes snapshot when the run settles during the read', async () => {
      await service.startGeneration(SESSION_ID, {})
      const internals = service as unknown as { changesSnapshots: Map<string, FileDiffInfo[]> }
      internals.changesSnapshots.clear()

      const diffMock = vi.mocked(fake.client.api.session.diff)
      let resolveDiff: (changes: FileDiffInfo[]) => void = () => {}
      diffMock.mockImplementationOnce(() => new Promise<FileDiffInfo[]>((resolve) => {
        resolveDiff = resolve
      }))

      const pending = service.readChangesForWalkthroughSession('ses_walk_1')
      await vi.waitFor(() => expect(diffMock).toHaveBeenCalledTimes(2))

      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))
      expect(internals.changesSnapshots.has('ses_walk_1')).toBe(false)

      resolveDiff(THREE_HUNKS)
      await pending

      expect(internals.changesSnapshots.has('ses_walk_1')).toBe(false)

      await service.readChangesForWalkthroughSession('ses_walk_1')
      expect(diffMock).toHaveBeenCalledTimes(3)
    })

    it('leaves a cancelled record unchanged when the interrupted event arrives', async () => {
      await service.startGeneration(SESSION_ID, {})
      await service.cancelGeneration(SESSION_ID)

      service.handleEvent(sessionEvent('session.execution.interrupted', 'ses_walk_1'))

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('cancelled')
    })

    it('expires a generating record when the timer fires and interrupts the session', async () => {
      vi.useFakeTimers()
      try {
        const timed = new ChangeWalkthroughService(
          db,
          fake.client,
          new SettingsService(db),
          createGitAuthService(),
          gitService,
          { walkthroughsRoot, generationTimeoutMs: 1000 },
        )
        await timed.startGeneration(SESSION_ID, {})

        await vi.advanceTimersByTimeAsync(1000)

        const state = await timed.getState(SESSION_ID)
        expect(state.generating).toBe(false)
        expect(state.error).toMatchObject({ code: 'WALKTHROUGH_TIMEOUT' })
        expect(fake.interruptCalls).toContain('ses_walk_1')
      } finally {
        vi.useRealTimers()
      }
    })

    it('refines a ready walkthrough by prompting the same session', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')
      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))
      const before = fake.promptCalls.length

      const state = await service.refine(SESSION_ID, { text: 'Explain the risk section' })

      expect(fake.promptCalls).toHaveLength(before + 1)
      expect(fake.promptCalls.at(-1)!.sessionID).toBe('ses_walk_1')
      expect(fake.promptCalls.at(-1)!.text).toContain('Explain the risk section')
      expect(state.generating).toBe(true)
      expect(state.running).toBe(true)
      expect(state.walkthrough?.status).toBe('generating')
    })

    it('rejects a refine while the walkthrough is generating', async () => {
      await service.startGeneration(SESSION_ID, {})

      await expect(service.refine(SESSION_ID, { text: 'more' })).rejects.toMatchObject({
        status: 409,
        code: 'WALKTHROUGH_BUSY',
      })
    })

    it('rejects a refine when no walkthrough session exists', async () => {
      await expect(service.refine(SESSION_ID, { text: 'more' })).rejects.toMatchObject({
        status: 409,
        code: 'WALKTHROUGH_NOT_STARTED',
      })
    })

    it('marks failed when the walkthrough session is deleted while generating', async () => {
      await service.startGeneration(SESSION_ID, {})

      service.handleEvent(sessionEvent('session.deleted', 'ses_walk_1'))

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('failed')
      expect(state.error).toMatchObject({ code: 'WALKTHROUGH_SESSION_MISSING' })
      expect(state.running).toBe(false)
      expect(getChangeWalkthrough(db, SESSION_ID, 'session')).not.toBeNull()
    })

    it('settles a published walkthrough and clears its timer when the walkthrough session is deleted', async () => {
      await service.startGeneration(SESSION_ID, {})
      writeArtifact(fake.createCalls[0]!)
      await service.publishFromWalkthroughSession('ses_walk_1')
      const internals = service as unknown as { timers: Map<string, ReturnType<typeof setTimeout>> }
      expect(internals.timers.size).toBe(1)

      service.handleEvent(sessionEvent('session.deleted', 'ses_walk_1'))

      const state = await service.getState(SESSION_ID)
      expect(state.walkthrough?.status).toBe('ready')
      expect(state.generating).toBe(false)
      expect(state.running).toBe(false)
      expect(internals.timers.size).toBe(0)
      expect(getChangeWalkthrough(db, SESSION_ID, 'session')).not.toBeNull()
    })

    it('removes the walkthrough directory when the target session is deleted', async () => {
      await service.startGeneration(SESSION_ID, {})
      const targetRoot = path.join(walkthroughsRoot, SESSION_ID)
      expect(existsSync(targetRoot)).toBe(true)

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      await vi.waitFor(() => expect(existsSync(targetRoot)).toBe(false))
    })

    it('returns the outline, a file hunk and 404 for an unknown file', async () => {
      await service.startGeneration(SESSION_ID, {})

      const outline = await service.readChangesForWalkthroughSession('ses_walk_1')
      expect(outline).toContain('## Outline')
      expect(outline).toContain('src/a.ts')

      const fileText = await service.readChangesForWalkthroughSession('ses_walk_1', 'src/a.ts')
      expect(fileText).toContain('const a1 = 2')

      await expect(service.readChangesForWalkthroughSession('ses_walk_1', 'nope.ts')).rejects.toMatchObject({
        status: 404,
        code: 'WALKTHROUGH_FILE_NOT_CHANGED',
      })
    })

    it('rejects reading changes for an unknown walkthrough session', async () => {
      await expect(service.readChangesForWalkthroughSession('ses_other')).rejects.toMatchObject({
        status: 404,
        code: 'WALKTHROUGH_NOT_A_WALKTHROUGH_SESSION',
      })
    })
  })
})
