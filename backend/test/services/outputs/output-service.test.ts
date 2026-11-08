import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import type { FileDiffInfo, ModelInfo, SessionInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import {
  OUTPUT_GENERATION_TIMEOUT_MS,
  WALKTHROUGH_OUTPUT_DEFINITION,
  outputParamsKey,
  type OutputDefinition,
  type OutputParams,
  type SchedulePermissionRule,
} from '@opencode-manager/shared/schemas'
import { claimOutputGeneration, getOutput, updateOutput } from '../../../src/db/outputs'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import type { OpenCodeClient } from '../../../src/services/opencode/client'
import { SettingsService } from '../../../src/services/settings'
import type { GitService } from '../../../src/services/git/GitService'
import type { SSEEvent } from '../../../src/services/sse-aggregator'
import { stubLoadedModelCatalog } from '../../helpers/stub-opencode-client'
import {
  createCommittedRepo,
  createGitAuthService,
  createOrigin,
  cloneOrigin,
  git,
  uniqueName,
} from '../../helpers/git-fixtures'
import { computeChangesHash } from '../../../src/services/outputs/change-outline'
import { ChangesOutputProvider } from '../../../src/services/outputs/changes-provider'
import { OutputDefinitionRegistry } from '../../../src/services/outputs/definition-registry'
import { buildOutputSessionPermissions, buildOutputSessionPrompt } from '../../../src/services/outputs/output-prompt'
import { OutputService } from '../../../src/services/outputs/output-service'

const SESSION_ID = 'ses_output'
const DEFINITION_ID = 'walkthrough'
const SESSION_PARAMS = { source: { kind: 'session' } } as const

let db: Database

function paramsKey(params: OutputParams = SESSION_PARAMS): string {
  return outputParamsKey(params)
}

function recordKey(params: OutputParams = SESSION_PARAMS) {
  return { sessionId: SESSION_ID, definitionId: DEFINITION_ID, paramsKey: paramsKey(params) }
}

function markPublished(params: OutputParams = SESSION_PARAMS): void {
  const updated = updateOutput(db, recordKey(params), ['generating'], {
    status: 'ready',
    publishedAt: 1,
    updatedAt: Date.now(),
  })
  expect(updated).not.toBeNull()
}

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

const repoRoot = mkdtempSync(path.join(tmpdir(), 'output-service-'))
const outputsRoot = mkdtempSync(path.join(tmpdir(), 'outputs-root-'))

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})

function createChangedRepo(): string {
  const repo = path.join(repoRoot, uniqueName('repo'))
  createCommittedRepo(repo)
  writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  git(['add', 'a.txt'], repo)
  git(['commit', '-m', 'add a'], repo)
  writeFileSync(path.join(repo, 'a.txt'), 'two\n')
  return repo
}

function createPullRequestRepo(): string {
  const origin = path.join(repoRoot, uniqueName('pr-origin'))
  const work = path.join(repoRoot, uniqueName('pr-work'))
  const clone = path.join(repoRoot, uniqueName('pr-clone'))
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

describe('buildOutputSessionPermissions', () => {
  it('denies edits everywhere, allows the output directory, and keeps the unattended baseline', () => {
    const ruleset = buildOutputSessionPermissions('/tmp/out/dir')

    expect(ruleset).toContainEqual({ action: 'edit', resource: '*', effect: 'deny' })
    expect(ruleset).toContainEqual({ action: 'external_directory', resource: '*', effect: 'deny' })
    expect(ruleset.at(-2)).toEqual({ action: 'external_directory', resource: '/tmp/out/dir/*', effect: 'allow' })
    expect(ruleset.at(-1)).toEqual({ action: 'edit', resource: '/tmp/out/dir/*', effect: 'allow' })
  })

  it('normalizes the output directory', () => {
    const ruleset = buildOutputSessionPermissions('/tmp/out/../out/dir/')

    expect(ruleset.at(-2)!.resource).toBe('/tmp/out/dir/*')
  })
})

describe('buildOutputSessionPrompt', () => {
  it('states the role, the data actions, the reading order and the output directory', () => {
    const prompt = buildOutputSessionPrompt({
      definition: WALKTHROUGH_OUTPUT_DEFINITION,
      title: 'My session',
      params: SESSION_PARAMS,
      outputDir: '/tmp/outputs/ses_1/gen',
    })

    expect(prompt).toContain('My session')
    expect(prompt).toContain('read_output_input')
    expect(prompt).toContain('publish_output')
    expect(prompt).toContain('contracts and data model first')
    expect(prompt).toContain('"stops"')
    expect(prompt).toContain('/tmp/outputs/ses_1/gen')
  })

  it('asks for a self-contained HTML file with the html renderer', () => {
    const definition: OutputDefinition = {
      ...WALKTHROUGH_OUTPUT_DEFINITION,
      renderer: { kind: 'html' },
      dataSchema: undefined,
    }

    const prompt = buildOutputSessionPrompt({
      definition,
      title: 'My session',
      params: SESSION_PARAMS,
      outputDir: '/tmp/outputs/ses_1/gen',
    })

    expect(prompt).toContain('/tmp/outputs/ses_1/gen/index.html')
    expect(prompt).toContain('self-contained HTML')
  })
})

describe('OutputService', () => {
  let sessions: Record<string, FakeSession>
  let fake: ReturnType<typeof createFakeClient>
  let service: OutputService
  let registry: OutputDefinitionRegistry
  let provider: ChangesOutputProvider
  let gitService: GitService
  let fetchRemoteRef: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = createTestDb()
    sessions = { [SESSION_ID]: { changes: THREE_HUNKS, info: sessionAt('/abs/repo') } }
    fake = createFakeClient(sessions)
    fetchRemoteRef = vi.fn(async () => {})
    gitService = { fetchRemoteRef } as unknown as GitService
    registry = new OutputDefinitionRegistry(db)
    provider = new ChangesOutputProvider(fake.client, createGitAuthService(), gitService, db)
    service = new OutputService(db, fake.client, new SettingsService(db), registry, { changes: provider }, { outputsRoot })
  })

  afterEach(() => {
    db.close()
  })

  const createService = (generationTimeoutMs?: number): OutputService =>
    new OutputService(db, fake.client, new SettingsService(db), registry, { changes: provider }, {
      outputsRoot,
      ...(generationTimeoutMs === undefined ? {} : { generationTimeoutMs }),
    })

  it('throws 404 for a missing session on GET', async () => {
    await expect(service.getState('ses_missing', DEFINITION_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('reports no output and a current hash on GET', async () => {
    const state = await service.getState(SESSION_ID, DEFINITION_ID)

    expect(state.output).toBeNull()
    expect(state.stale).toBe(false)
    expect(state.currentInputHash).toBe(computeChangesHash(THREE_HUNKS))
    expect(state.hasInput).toBe(true)
    expect(state.generating).toBe(false)
    expect(state.error).toBeNull()
  })

  it('reports no changes for a session with an empty diff', async () => {
    sessions[SESSION_ID]!.changes = []

    const state = await service.getState(SESSION_ID, DEFINITION_ID)

    expect(state.currentInputHash).toBe(computeChangesHash([]))
    expect(state.hasInput).toBe(false)
  })

  it('lists the helper sessions and identifies generator sessions', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    expect(service.listHelperSessionIds()).toEqual(['ses_walk_1'])
    expect(service.isGeneratorSession('ses_walk_1')).toBe(true)
    expect(service.isGeneratorSession('ses_other')).toBe(false)
  })

  it('creates exactly one generator and returns generating', async () => {
    const state = await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    expect(fake.createCalls).toHaveLength(1)
    const created = fake.createCalls[0]!
    expect(created.title).toBe('Walkthrough · Title')
    expect(created.model).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
    expect(created.location).toEqual({ directory: '/abs/repo' })

    const permissions = created.permissions as SchedulePermissionRule[]
    const outputDir = outputDirFromPermissions(permissions)
    expect(outputDir.startsWith(path.join(outputsRoot, SESSION_ID))).toBe(true)
    expect(existsSync(outputDir)).toBe(true)

    expect(fake.promptCalls).toHaveLength(1)
    expect(fake.promptCalls[0]!.sessionID).toBe('ses_walk_1')
    expect(fake.promptCalls[0]!.text).toContain(outputDir)
    expect(fake.promptCalls[0]!.text).toContain('publish_output')

    const stored = getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())
    expect(state.generating).toBe(true)
    expect(state.output?.status).toBe('generating')
    expect(state.output?.generatorSessionId).toBe('ses_walk_1')
    expect(state.output?.generatorSessionId).toBe(stored?.generatorSessionId)
    expect(state.output?.outputDir).toBe(outputDir)
    expect(state.output?.outputDir).toBe(stored?.outputDir)
  })

  it('uses the source description in the session title for a git source', async () => {
    const repo = createChangedRepo()
    sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }

    await service.startGeneration(SESSION_ID, {
      definitionId: DEFINITION_ID,
      params: { source: { kind: 'uncommitted' } },
    })

    expect(fake.createCalls[0]!.title).toBe('Walkthrough · Title — uncommitted changes')
  })

  it('does not create another session while one is generating', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    const second = await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    expect(fake.createCalls).toHaveLength(1)
    expect(second.generating).toBe(true)
  })

  it('returns the ready record without a new session when the input is unchanged', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    markPublished()

    const state = await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    expect(fake.createCalls).toHaveLength(1)
    expect(state.generating).toBe(false)
    expect(state.output?.status).toBe('ready')
  })

  it('spawns a new session and generation directory when regenerate is set', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    const firstDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
    markPublished()

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, regenerate: true })

    expect(fake.createCalls).toHaveLength(2)
    const secondDir = outputDirFromPermissions(fake.createCalls[1]!.permissions as SchedulePermissionRule[])
    expect(secondDir).not.toBe(firstDir)
    expect(existsSync(secondDir)).toBe(true)
  })

  it('spawns a new session when the input changed', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    markPublished()
    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    expect(fake.createCalls).toHaveLength(2)
  })

  it('rejects with 409 and creates no session when there are no changes', async () => {
    sessions[SESSION_ID]!.changes = []

    await expect(service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })).rejects.toMatchObject({
      status: 409,
      code: 'OUTPUT_NO_CHANGES',
    })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('rejects with 409 and creates no session when there are no text changes', async () => {
    sessions[SESSION_ID]!.changes = [
      change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
    ]

    await expect(service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })).rejects.toMatchObject({
      status: 409,
      code: 'OUTPUT_NO_TEXT_CHANGES',
    })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('marks the record failed when session.create fails and reports the error', async () => {
    fake.setCreateImpl(async () => {
      throw new Error('create failed')
    })

    await expect(service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })).rejects.toMatchObject({
      status: 502,
      code: 'OUTPUT_SESSION_START_FAILED',
    })

    const state = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(state.generating).toBe(false)
    expect(state.error).toMatchObject({ message: 'create failed' })
  })

  it('marks the record failed when the prompt fails and reports the error', async () => {
    vi.mocked(fake.client.api.session.prompt).mockRejectedValueOnce(new Error('prompt failed'))

    await expect(service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })).rejects.toMatchObject({
      status: 502,
      code: 'OUTPUT_SESSION_START_FAILED',
    })

    const state = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(state.output?.status).toBe('failed')
    expect(state.error).toMatchObject({ message: 'prompt failed' })
  })

  it('removes the generation directory and interrupts the session when the prompt fails', async () => {
    vi.mocked(fake.client.api.session.prompt).mockRejectedValueOnce(new Error('prompt failed'))

    await expect(service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })).rejects.toMatchObject({
      status: 502,
    })

    const outputDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
    expect(existsSync(outputDir)).toBe(false)
    expect(fake.interruptCalls).toContain('ses_walk_1')
  })

  it('rejects with 502 when reading changes fails', async () => {
    sessions[SESSION_ID]!.changes = new Error('diff failed')

    await expect(service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })).rejects.toMatchObject({
      status: 502,
      code: 'OUTPUT_CHANGES_UNAVAILABLE',
    })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('resolves the configured model over the request and session model', async () => {
    new SettingsService(db).updateSettings({ walkthroughModel: 'openai/gpt-5' })
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      location: { directory: '/abs/repo' },
    } as SessionInfo

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, model: 'openai/gpt-5-mini' })

    expect(fake.createCalls[0]!.model).toEqual({ providerID: 'openai', id: 'gpt-5' })
  })

  it('prefers the output model over the legacy walkthrough model', async () => {
    new SettingsService(db).updateSettings({
      outputModel: 'openai/gpt-5',
      walkthroughModel: 'anthropic/claude-sonnet-4',
    })
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      location: { directory: '/abs/repo' },
    } as SessionInfo

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, model: 'openai/gpt-5-mini' })

    expect(fake.createCalls[0]!.model).toEqual({ providerID: 'openai', id: 'gpt-5' })
  })

  it('ignores the legacy walkthrough model when the output model is explicitly cleared', async () => {
    new SettingsService(db).updateSettings({
      outputModel: '',
      walkthroughModel: 'openai/gpt-5',
    })
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      location: { directory: '/abs/repo' },
    } as SessionInfo

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, model: 'openai/gpt-5-mini' })

    expect(fake.createCalls[0]!.model).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('uses the request model over the session model', async () => {
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      location: { directory: '/abs/repo' },
    } as SessionInfo

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, model: 'openai/gpt-5-mini' })

    expect(fake.createCalls[0]!.model).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('caches the current hash until a session execution event', async () => {
    await service.getState(SESSION_ID, DEFINITION_ID)
    await service.getState(SESSION_ID, DEFINITION_ID)

    expect(vi.mocked(fake.client.api.session.diff)).toHaveBeenCalledTimes(1)
  })

  it('recomputes the hash after session.execution.succeeded and reports stale', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]
    const cached = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(cached.stale).toBe(false)

    service.handleEvent(sessionEvent('session.execution.succeeded', SESSION_ID))

    const refreshed = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(refreshed.stale).toBe(true)
    expect(refreshed.currentInputHash).toBe(computeChangesHash([change('src/a.ts', hunkPatch(99))]))
  })

  it('reports a null current hash when changes cannot be read', async () => {
    sessions[SESSION_ID]!.changes = new Error('diff failed')

    const state = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(state.currentInputHash).toBeNull()
    expect(state.hasInput).toBe(true)
    expect(state.stale).toBe(false)
  })

  it('cancels a generating output and interrupts its session', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(true)

    const state = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(state.generating).toBe(false)
    expect(state.output?.status).toBe('cancelled')
    expect(fake.interruptCalls).toContain('ses_walk_1')
  })

  it('returns false from cancel when nothing is generating', async () => {
    expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(false)
  })

  it('expires a generating record older than the timeout on read', async () => {
    const shortTimeout = createService(50)
    await shortTimeout.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    updateOutput(db, recordKey(), ['generating'], { updatedAt: Date.now() - 10_000 })

    const state = await shortTimeout.getState(SESSION_ID, DEFINITION_ID)

    expect(state.generating).toBe(false)
    expect(state.error).toMatchObject({ code: 'OUTPUT_TIMEOUT' })
    await vi.waitFor(() => expect(fake.interruptCalls).toContain('ses_walk_1'))
  })

  describe('per-source storage', () => {
    it('stores outputs per source', async () => {
      const repo = createChangedRepo()
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }

      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      await service.startGeneration(SESSION_ID, {
        definitionId: DEFINITION_ID,
        params: { source: { kind: 'uncommitted' } },
      })

      const sessionStored = getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())
      const uncommittedStored = getOutput(
        db,
        SESSION_ID,
        DEFINITION_ID,
        paramsKey({ source: { kind: 'uncommitted' } }),
      )
      expect(sessionStored).not.toBeNull()
      expect(uncommittedStored).not.toBeNull()
      expect(uncommittedStored!.params.source).toEqual({ kind: 'uncommitted' })
    })

    it('deletes every source record when the target session is deleted', async () => {
      const repo = createChangedRepo()
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }

      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      await service.startGeneration(SESSION_ID, {
        definitionId: DEFINITION_ID,
        params: { source: { kind: 'uncommitted' } },
      })

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())).toBeNull()
      expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey({ source: { kind: 'uncommitted' } }))).toBeNull()
    })
  })

  describe('pull request sources', () => {
    it('fetches the refs during generation and deletes them with the session', async () => {
      const repo = createPullRequestRepo()
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info: sessionAt(repo) }
      fetchRemoteRef.mockImplementation(async (target: { fullPath: string }, remote: string, refspecs: string[]) => {
        git(['fetch', remote, ...refspecs], target.fullPath)
      })

      const headRef = `refs/ocm-output/${SESSION_ID}/pr/1/head`
      const baseRef = `refs/ocm-output/${SESSION_ID}/pr/1/base/main`

      await service.startGeneration(SESSION_ID, {
        definitionId: DEFINITION_ID,
        params: { source: { kind: 'pullRequest', number: 1, base: 'main' } },
      })

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
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    await service.getState(SESSION_ID, DEFINITION_ID)

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

    const pending = service.getState(SESSION_ID, DEFINITION_ID)
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

  describe('generator session lifecycle', () => {
    it('interrupts the previous session when regenerating a ready output', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      const firstDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
      markPublished()

      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, regenerate: true })

      expect(fake.createCalls).toHaveLength(2)
      expect(fake.interruptCalls).toContain('ses_walk_1')
      expect(existsSync(firstDir)).toBe(false)
    })

    it('cancels a generation interrupted before the generator session is recorded', async () => {
      let resolveCreate: (session: { id: string }) => void = () => {}
      fake.setCreateImpl(() => new Promise((resolve) => {
        resolveCreate = resolve
      }))

      const starting = service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      await vi.waitFor(() => expect(fake.createCalls).toHaveLength(1))

      expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(true)

      resolveCreate({ id: 'ses_walk_late' })
      await starting

      expect(fake.promptCalls).toHaveLength(0)
      expect(fake.interruptCalls).toContain('ses_walk_late')
      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('cancelled')
    })

    it('keeps the cancelled status when the interrupt event arrives during cancel', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      vi.mocked(fake.client.api.session.interrupt).mockImplementation(async ({ sessionID }) => {
        service.handleEvent(sessionEvent('session.execution.interrupted', sessionID))
        return { interrupted: true }
      })

      expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(true)

      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('cancelled')
      expect(state.error).toBeNull()
    })

    it('restores the previous status when the refine prompt fails', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()
      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))

      vi.mocked(fake.client.api.session.prompt).mockRejectedValueOnce(new Error('prompt failed'))

      await expect(service.refine(SESSION_ID, { definitionId: DEFINITION_ID, text: 'more' })).rejects.toMatchObject({
        status: 502,
      })

      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('ready')
      expect(state.generating).toBe(false)
      expect(state.running).toBe(false)
    })

    it('marks failed when the generator session finishes without publishing', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))

      await vi.waitFor(() => {
        expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.status).toBe('failed')
      })
      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('failed')
      expect(state.error).toMatchObject({ code: 'OUTPUT_NOT_PUBLISHED' })
    })

    it('keeps ready when the generator session finishes after publishing', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()

      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))

      await vi.waitFor(async () => {
        const state = await service.getState(SESSION_ID, DEFINITION_ID)
        expect(state.running).toBe(false)
      })
      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('ready')
      expect(state.error).toBeNull()
    })

    it('keeps the agent running after publishing and lets the timer settle it', async () => {
      vi.useFakeTimers()
      try {
        const timed = createService(1000)
        await timed.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
        markPublished()

        const published = await timed.getState(SESSION_ID, DEFINITION_ID)
        expect(published.output?.status).toBe('ready')
        expect(published.generating).toBe(false)
        expect(published.running).toBe(true)

        await vi.advanceTimersByTimeAsync(1000)

        const settled = await timed.getState(SESSION_ID, DEFINITION_ID)
        expect(settled.output?.status).toBe('ready')
        expect(settled.generating).toBe(false)
        expect(settled.running).toBe(false)
        expect(fake.interruptCalls).toContain('ses_walk_1')
      } finally {
        vi.useRealTimers()
      }
    })

    it('cancels a published output that is still running', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()

      expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(true)

      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('ready')
      expect(state.generating).toBe(false)
      expect(state.running).toBe(false)
      expect(fake.interruptCalls).toContain('ses_walk_1')
    })

    it('rejects a refine while the agent is still running after publishing', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()

      await expect(service.refine(SESSION_ID, { definitionId: DEFINITION_ID, text: 'more' })).rejects.toMatchObject({
        status: 409,
        code: 'OUTPUT_BUSY',
      })
    })

    it('interrupts a published generator session when the target session is deleted', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()
      const before = fake.interruptCalls.length

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      expect(fake.interruptCalls).toHaveLength(before + 1)
      expect(fake.interruptCalls).toContain('ses_walk_1')
    })

    it('leaves a cancelled record unchanged when the interrupted event arrives', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      await service.cancelGeneration(SESSION_ID, DEFINITION_ID)

      service.handleEvent(sessionEvent('session.execution.interrupted', 'ses_walk_1'))

      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('cancelled')
    })

    it('expires a generating record when the timer fires and interrupts the session', async () => {
      vi.useFakeTimers()
      try {
        const timed = createService(1000)
        await timed.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

        await vi.advanceTimersByTimeAsync(1000)

        const state = await timed.getState(SESSION_ID, DEFINITION_ID)
        expect(state.generating).toBe(false)
        expect(state.error).toMatchObject({ code: 'OUTPUT_TIMEOUT' })
        expect(fake.interruptCalls).toContain('ses_walk_1')
      } finally {
        vi.useRealTimers()
      }
    })

    it('refines a ready output by prompting the same session', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()
      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))
      const before = fake.promptCalls.length

      const state = await service.refine(SESSION_ID, {
        definitionId: DEFINITION_ID,
        text: 'Explain the risk section',
      })

      expect(fake.promptCalls).toHaveLength(before + 1)
      expect(fake.promptCalls.at(-1)!.sessionID).toBe('ses_walk_1')
      expect(fake.promptCalls.at(-1)!.text).toContain('Explain the risk section')
      expect(state.generating).toBe(true)
      expect(state.running).toBe(true)
      expect(state.output?.status).toBe('generating')
    })

    it('rejects a refine while the output is generating', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

      await expect(service.refine(SESSION_ID, { definitionId: DEFINITION_ID, text: 'more' })).rejects.toMatchObject({
        status: 409,
        code: 'OUTPUT_BUSY',
      })
    })

    it('rejects a refine when no output session exists', async () => {
      await expect(service.refine(SESSION_ID, { definitionId: DEFINITION_ID, text: 'more' })).rejects.toMatchObject({
        status: 409,
        code: 'OUTPUT_NOT_STARTED',
      })
    })

    it('marks failed when the generator session is deleted while generating', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

      service.handleEvent(sessionEvent('session.deleted', 'ses_walk_1'))

      await vi.waitFor(() => {
        expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.status).toBe('failed')
      })
      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('failed')
      expect(state.error).toMatchObject({ code: 'OUTPUT_SESSION_MISSING' })
      expect(state.running).toBe(false)
      expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())).not.toBeNull()
    })

    it('settles a published output and clears its timer when the generator session is deleted', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      markPublished()
      const internals = service as unknown as { timers: Map<string, ReturnType<typeof setTimeout>> }
      expect(internals.timers.size).toBe(1)

      service.handleEvent(sessionEvent('session.deleted', 'ses_walk_1'))

      await vi.waitFor(() => expect(internals.timers.size).toBe(0))
      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('ready')
      expect(state.generating).toBe(false)
      expect(state.running).toBe(false)
      expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())).not.toBeNull()
    })

    it('removes the output directory when the target session is deleted', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      const targetRoot = path.join(outputsRoot, SESSION_ID)
      expect(existsSync(targetRoot)).toBe(true)

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      await vi.waitFor(() => expect(existsSync(targetRoot)).toBe(false))
    })
  })

  describe('publish state transitions and snapshots', () => {
    it('leaves the record generating until a publish marks it ready', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.status).toBe('generating')

      markPublished()

      const outputDir = outputDirFromPermissions(fake.createCalls[0]!.permissions as SchedulePermissionRule[])
      const state = await service.getState(SESSION_ID, DEFINITION_ID)
      expect(state.output?.status).toBe('ready')
      expect(state.output?.publishedAt).not.toBeNull()
      expect(state.output?.outputDir).toBe(outputDir)
    })

    it('rejects a publish from a superseded generator session', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

      const claimed = claimOutputGeneration(db, {
        sessionId: SESSION_ID,
        definitionId: DEFINITION_ID,
        params: SESSION_PARAMS,
        inputHash: 'hash-new',
        generationId: 'gen-new',
        outputDir: '/workspace/outputs/gen-new',
        model: null,
        now: Date.now() + OUTPUT_GENERATION_TIMEOUT_MS + 1,
      })
      expect(claimed).toBe(true)

      const updated = updateOutput(
        db,
        recordKey(),
        ['generating', 'ready', 'failed'],
        { status: 'ready', publishedAt: 1, updatedAt: Date.now() },
        { generatorSessionId: 'ses_walk_1' },
      )
      expect(updated).toBeNull()

      const stored = getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())
      expect(stored?.status).toBe('generating')
      expect(stored?.generatorSessionId).toBeNull()
    })

    it('rejects a publish from a cancelled generator session', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(true)

      const updated = updateOutput(
        db,
        recordKey(),
        ['generating', 'ready', 'failed'],
        { status: 'ready', publishedAt: 1, updatedAt: Date.now() },
        { generatorSessionId: 'ses_walk_1' },
      )
      expect(updated).toBeNull()
      expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.status).toBe('cancelled')
    })

    it('keeps the per-run input snapshot until refine', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      const internals = service as unknown as { inputSnapshots: Map<string, FileDiffInfo[]> }
      expect(internals.inputSnapshots.has('ses_walk_1')).toBe(true)

      markPublished()
      service.handleEvent(sessionEvent('session.execution.succeeded', 'ses_walk_1'))
      await vi.waitFor(() => {
        expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.executionStartedAt).toBeNull()
      })

      await service.refine(SESSION_ID, { definitionId: DEFINITION_ID, text: 'more' })
      expect(internals.inputSnapshots.has('ses_walk_1')).toBe(false)
    })

    it('clears the input snapshot when a generation settles', async () => {
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
      const internals = service as unknown as { inputSnapshots: Map<string, FileDiffInfo[]> }
      expect(internals.inputSnapshots.has('ses_walk_1')).toBe(true)

      expect(await service.cancelGeneration(SESSION_ID, DEFINITION_ID)).toBe(true)
      expect(internals.inputSnapshots.has('ses_walk_1')).toBe(false)
    })
  })

  it('starts a generation for all six source kinds', async () => {
    const uncommittedRepo = createChangedRepo()
    const stagedRepo = createChangedRepo()
    git(['add', 'a.txt'], stagedRepo)
    const unstagedRepo = createChangedRepo()
    const branchRepo = path.join(repoRoot, uniqueName('branch'))
    createCommittedRepo(branchRepo)
    git(['checkout', '-b', 'feature'], branchRepo)
    writeFileSync(path.join(branchRepo, 'feature.txt'), 'feature\n')
    git(['add', 'feature.txt'], branchRepo)
    git(['commit', '-m', 'feature'], branchRepo)
    const pullRequestRepo = createPullRequestRepo()
    fetchRemoteRef.mockImplementation(async (target: { fullPath: string }, remote: string, refspecs: string[]) => {
      git(['fetch', remote, ...refspecs], target.fullPath)
    })

    const sources = [
      { source: { kind: 'session' as const }, info: sessionAt('/abs/repo') },
      { source: { kind: 'uncommitted' as const }, info: sessionAt(uncommittedRepo) },
      { source: { kind: 'staged' as const }, info: sessionAt(stagedRepo) },
      { source: { kind: 'unstaged' as const }, info: sessionAt(unstagedRepo) },
      { source: { kind: 'branch' as const, base: 'main' }, info: sessionAt(branchRepo) },
      {
        source: { kind: 'pullRequest' as const, number: 1, base: 'main' },
        info: sessionAt(pullRequestRepo),
      },
    ]

    for (const { source, info } of sources) {
      sessions[SESSION_ID] = { changes: THREE_HUNKS, info }
      const before = fake.createCalls.length
      await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, params: { source } })

      expect(fake.createCalls).toHaveLength(before + 1)
      const stored = getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey({ source }))
      expect(stored).not.toBeNull()
      expect(stored!.params.source).toEqual(source)
    }
  })

  it('rejects generation and refinement for a currentSession definition', async () => {
    registry.defineSession(SESSION_ID, {
      id: 'note',
      label: 'Note',
      description: '',
      icon: 'FileText',
      params: [],
      instructions: 'Write a note.',
      dataSchema: { type: 'object', properties: { text: { type: 'string' } } },
      renderer: { kind: 'template', html: '<p></p>' },
      generation: 'currentSession',
    })

    await expect(service.startGeneration(SESSION_ID, { definitionId: 'note', params: {} })).rejects.toMatchObject({
      status: 409,
      code: 'OUTPUT_GENERATION_NOT_SUPPORTED',
    })
    await expect(service.refine(SESSION_ID, { definitionId: 'note', params: {}, text: 'more' })).rejects.toMatchObject({
      status: 409,
      code: 'OUTPUT_GENERATION_NOT_SUPPORTED',
    })
  })

  it('returns the outline, a file hunk and 404 for an unknown file', () => {
    const outline = provider.format(THREE_HUNKS, {
      title: 'Title',
      sourceDescription: 'the changes in this session',
    })
    expect(outline).toContain('## Outline')
    expect(outline).toContain('src/a.ts')

    const fileText = provider.format(
      THREE_HUNKS,
      { title: 'Title', sourceDescription: 'the changes in this session' },
      'src/a.ts',
    )
    expect(fileText).toContain('const a1 = 2')

    expect(() => provider.format(
      THREE_HUNKS,
      { title: 'Title', sourceDescription: 'the changes in this session' },
      'nope.ts',
    )).toThrow(expect.objectContaining({ status: 404, code: 'OUTPUT_FILE_NOT_CHANGED' }))
  })
})
