import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import type {
  FileDiffInfo,
  ModelInfo,
  SessionInfo,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'
import {
  OUTPUT_GENERATION_TIMEOUT_MS,
  outputParamsKey,
  type OutputDefinitionInput,
  type OutputParams,
  type WalkthroughOutputData,
} from '@opencode-manager/shared/schemas'
import { claimOutputGeneration, getOutput } from '../../../src/db/outputs'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import type { OpenCodeClient } from '../../../src/services/opencode/client'
import { SettingsService } from '../../../src/services/settings'
import type { GitService } from '../../../src/services/git/GitService'
import { stubLoadedModelCatalog } from '../../helpers/stub-opencode-client'
import { createGitAuthService } from '../../helpers/git-fixtures'
import { buildChangesInput } from '../../../src/services/outputs/change-outline'
import { finalizeWalkthroughData } from '../../../src/services/outputs/builtin-finalizers'
import { ChangesOutputProvider } from '../../../src/services/outputs/changes-provider'
import { OutputDefinitionRegistry } from '../../../src/services/outputs/definition-registry'
import { OutputService } from '../../../src/services/outputs/output-service'

const SESSION_ID = 'ses_output'
const DEFINITION_ID = 'walkthrough'
const SESSION_PARAMS = { source: { kind: 'session' } } as const
const TEMPLATE_HTML = '<!doctype html><html><body><h1>Note</h1></body></html>'

let db: Database

function paramsKey(params: OutputParams = SESSION_PARAMS): string {
  return outputParamsKey(params)
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

function templateDefinitionInput(): OutputDefinitionInput {
  return {
    id: 'note',
    label: 'Note',
    description: 'A note',
    icon: 'FileText',
    params: [],
    instructions: 'Write a note.',
    dataSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    renderer: { kind: 'template', html: TEMPLATE_HTML },
    generation: 'currentSession',
  }
}

function htmlDefinitionInput(): OutputDefinitionInput {
  return {
    id: 'report',
    label: 'Report',
    description: 'A report',
    icon: 'FileText',
    params: [],
    instructions: 'Write a report.',
    renderer: { kind: 'html' },
    generation: 'currentSession',
  }
}

interface FakeSession {
  info?: SessionInfo | Error
  changes?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const createCalls: Array<Record<string, unknown>> = []
  const promptCalls: Array<{ sessionID: string; text: string }> = []
  const interruptCalls: string[] = []
  let createSeq = 0

  const client = {
    api: {
      ...stubLoadedModelCatalog([
        { providerID: 'openai', id: 'gpt-5-mini', enabled: true },
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
          return { id: `ses_walk_${++createSeq}` }
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

  return { client, createCalls, promptCalls, interruptCalls }
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function sessionAt(directory: string, id: string = SESSION_ID): SessionInfo {
  return { id, title: 'Title', location: { directory } } as SessionInfo
}

const repoRoot = mkdtempSync(path.join(tmpdir(), 'output-publish-'))
const outputsRoot = mkdtempSync(path.join(tmpdir(), 'outputs-publish-root-'))

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})

describe('finalizeWalkthroughData', () => {
  const changes: FileDiffInfo[] = [
    change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
    change('src/b.ts', hunkPatch(1)),
    change('pnpm-lock.yaml', hunkPatch(1)),
  ]

  it('replaces hunk ids with their hunks and lists the unreferenced hunks', () => {
    const input = buildChangesInput(changes)
    const referenced = input.hunks[0]!
    const finalized = finalizeWalkthroughData(
      {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: [referenced.id] }],
      },
      changes,
    )

    expect(finalized.data.stops[0]!.hunks).toEqual([referenced])
    expect(finalized.data.stops[0]!).not.toHaveProperty('hunkIds')
    const otherIds = finalized.data.otherHunks.map((hunk) => hunk.id)
    expect(otherIds).toEqual([
      input.hunks[1]!.id,
      input.hunks[2]!.id,
      input.mechanicalHunks[0]!.id,
    ])
    expect(finalized.uncoveredHunkIds).toEqual(otherIds)
  })

  it('names every distinct unknown hunk id', () => {
    let caught: unknown
    try {
      finalizeWalkthroughData(
        {
          title: 'Title',
          summary: 'Summary',
          stops: [
            { id: 's1', title: 'Stop', explanation: 'Explain', hunkIds: ['h_missing', 'h_other'] },
            { id: 's2', title: 'Stop', explanation: 'Explain', hunkIds: ['h_missing'] },
          ],
        },
        changes,
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ status: 400, code: 'OUTPUT_UNKNOWN_HUNK' })
    const message = (caught as Error).message
    expect(message).toContain('h_missing')
    expect(message).toContain('h_other')
    expect(message.match(/h_missing/g)).toHaveLength(1)
  })
})

describe('OutputService publish', () => {
  let sessions: Record<string, FakeSession>
  let fake: ReturnType<typeof createFakeClient>
  let service: OutputService
  let registry: OutputDefinitionRegistry
  let provider: ChangesOutputProvider

  beforeEach(() => {
    db = createTestDb()
    sessions = { [SESSION_ID]: { changes: THREE_HUNKS, info: sessionAt('/abs/repo') } }
    fake = createFakeClient(sessions)
    const gitService = { fetchRemoteRef: vi.fn(async () => {}) } as unknown as GitService
    registry = new OutputDefinitionRegistry(db)
    provider = new ChangesOutputProvider(fake.client, createGitAuthService(), gitService, db)
    service = new OutputService(db, fake.client, new SettingsService(db), registry, { changes: provider }, { outputsRoot })
  })

  afterEach(() => {
    db.close()
  })

  it('rejects invalid data and keeps the record generating', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    await expect(service.publish('ses_walk_1', { data: { title: 123 } })).rejects.toMatchObject({
      status: 400,
      code: 'OUTPUT_DATA_INVALID',
    })

    expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.status).toBe('generating')
  })

  it('rejects an unknown hunk id and keeps the record generating', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    await expect(service.publish('ses_walk_1', {
      data: {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: ['h_missing'] }],
      },
    })).rejects.toMatchObject({ status: 400, code: 'OUTPUT_UNKNOWN_HUNK' })

    expect(getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())?.status).toBe('generating')
  })

  it('publishes walkthrough data from the start snapshot in diff order', async () => {
    const changes: FileDiffInfo[] = [
      change('pnpm-lock.yaml', hunkPatch(1)),
      change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
      change('src/b.ts', hunkPatch(1)),
    ]
    sessions[SESSION_ID]!.changes = changes
    const input = buildChangesInput(changes)
    const referenced = input.hunks[0]!
    const expectedOther = [input.mechanicalHunks[0]!, input.hunks[1]!, input.hunks[2]!]

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]

    const result = await service.publish('ses_walk_1', {
      data: {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: [referenced.id] }],
        risks: ['A risk'],
      },
    })

    const written = JSON.parse(readFileSync(path.join(result.outputDir, 'data.json'), 'utf8')) as WalkthroughOutputData
    expect(written.stops[0]!.hunks[0]!.text).toBe(referenced.text)
    expect(written.stops[0]!.hunks[0]!.header).toBe(referenced.header)
    expect(written.otherHunks.map((hunk) => hunk.id)).toEqual(expectedOther.map((hunk) => hunk.id))
    expect(result.uncoveredHunkIds).toEqual(expectedOther.map((hunk) => hunk.id))
    expect(written.risks).toEqual(['A risk'])
    expect(written.testing).toBeUndefined()

    const state = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(state.output?.status).toBe('ready')
    expect(state.output?.publishedAt).not.toBeNull()
  })

  it('re-reads the input through the provider when the snapshot is gone', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    const internals = service as unknown as { inputSnapshots: Map<string, unknown> }
    internals.inputSnapshots.delete('ses_walk_1')

    const referenced = buildChangesInput(THREE_HUNKS).hunks[0]!
    const result = await service.publish('ses_walk_1', {
      data: {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: [referenced.id] }],
      },
    })

    const written = JSON.parse(readFileSync(path.join(result.outputDir, 'data.json'), 'utf8')) as WalkthroughOutputData
    expect(written.stops[0]!.hunks[0]!.text).toBe(referenced.text)
    const state = await service.getState(SESSION_ID, DEFINITION_ID)
    expect(state.output?.status).toBe('ready')
  })

  it('rejects a publish from a generator superseded by a takeover', async () => {
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

    await expect(service.publish('ses_walk_1', {
      data: {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: [] }],
      },
    })).rejects.toMatchObject({ status: 409, code: 'OUTPUT_SUPERSEDED' })
  })

  it('rejects a publish from a generator superseded by a regenerate', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })
    await service.publish('ses_walk_1', {
      data: {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: [] }],
      },
    })

    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID, regenerate: true })

    await expect(service.publish('ses_walk_1', {
      data: {
        title: 'Title',
        summary: 'Summary',
        stops: [{ id: 'stop-1', title: 'Stop', explanation: 'Explain', hunkIds: [] }],
      },
    })).rejects.toMatchObject({ status: 409, code: 'OUTPUT_SUPERSEDED' })

    const stored = getOutput(db, SESSION_ID, DEFINITION_ID, paramsKey())
    expect(stored?.generatorSessionId).toBe('ses_walk_2')
    expect(stored?.status).toBe('generating')
  })

  it('rejects read_input for a session that is not an output session', async () => {
    await expect(service.readInput(SESSION_ID)).rejects.toMatchObject({
      status: 404,
      code: 'OUTPUT_NOT_A_GENERATOR_SESSION',
    })
  })

  it('reads the outline and file hunks from the start snapshot', async () => {
    await service.startGeneration(SESSION_ID, { definitionId: DEFINITION_ID })

    const outline = await service.readInput('ses_walk_1')
    expect(outline).toContain('## Outline')
    expect(outline).toContain('src/a.ts')

    const file = await service.readInput('ses_walk_1', 'src/a.ts')
    expect(file).toContain('const a1 = 2')

    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]
    const after = await service.readInput('ses_walk_1', 'src/a.ts')
    expect(after).toContain('const a1 = 2')
    expect(after).not.toContain('const a99 = 2')
  })

  it('stores a session definition resolvable through the registry', () => {
    const definition = service.defineSessionOutput(SESSION_ID, templateDefinitionInput())

    expect(definition).toMatchObject({ id: 'note', origin: 'session', generation: 'currentSession' })
    expect(registry.get(SESSION_ID, 'note')).toMatchObject({ id: 'note', origin: 'session' })
    expect(() => registry.get('ses_other', 'note')).toThrow(expect.objectContaining({ status: 404 }))
  })

  it('publishes current-session template data and writes the template html', async () => {
    service.defineSessionOutput(SESSION_ID, templateDefinitionInput())

    const result = await service.publish(SESSION_ID, { definitionId: 'note', data: { text: 'hello' } })

    const state = await service.getState(SESSION_ID, 'note')
    expect(state.output?.status).toBe('ready')
    expect(state.output?.publishedAt).not.toBeNull()
    expect(result.uncoveredHunkIds).toEqual([])
    expect(JSON.parse(readFileSync(path.join(result.outputDir, 'data.json'), 'utf8'))).toEqual({ text: 'hello' })
    expect(readFileSync(path.join(result.outputDir, 'index.html'), 'utf8')).toBe(TEMPLATE_HTML)
    await expect(service.getState('ses_other', 'note')).rejects.toMatchObject({ status: 404 })
  })

  it('copies a current-session html artifact into the output directory', async () => {
    const sessionDirectory = mkdtempSync(path.join(repoRoot, 'session-'))
    writeFileSync(path.join(sessionDirectory, 'report.html'), '<!doctype html><html><body>report</body></html>')
    sessions[SESSION_ID]!.info = sessionAt(sessionDirectory)
    service.defineSessionOutput(SESSION_ID, htmlDefinitionInput())

    const result = await service.publish(SESSION_ID, {
      definitionId: 'report',
      path: 'report.html',
      data: undefined,
    })

    expect(readFileSync(path.join(result.outputDir, 'index.html'), 'utf8')).toContain('report</body>')
    const state = await service.getState(SESSION_ID, 'report')
    expect(state.output?.status).toBe('ready')
    expect(state.output?.publishedAt).not.toBeNull()
  })
})
