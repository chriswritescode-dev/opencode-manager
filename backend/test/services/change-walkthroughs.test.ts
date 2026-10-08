import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import type { FileDiffInfo, ModelRef, SessionInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import {
  WALKTHROUGH_DIFF_MAX_CHARS,
  WALKTHROUGH_HUNK_MAX_CHARS,
  WALKTHROUGH_MAX_STOPS,
  WALKTHROUGH_TEXT_MAX_CHARS,
  type WalkthroughHunk,
} from '@opencode-manager/shared/schemas'
import { getChangeWalkthrough } from '../../src/db/change-walkthroughs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import { stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import {
  ChangeWalkthroughError,
  ChangeWalkthroughService,
  buildWalkthroughInput,
  buildWalkthroughPrompt,
  computeChangesHash,
  computeHunkId,
  computeStopId,
  isMechanicalChangePath,
  parseWalkthroughResponse,
} from '../../src/services/change-walkthroughs'

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

function bigHunk(index: number, size = WALKTHROUGH_HUNK_MAX_CHARS): string {
  return `@@ -${index},1 +${index},1 @@\n+${'x'.repeat(size)}`
}

function modelReply(
  stops: Array<{ title: string; explanation: string; hunkIds: string[] }>,
  summary = 'Summary',
): string {
  return JSON.stringify({ summary, stops })
}

function hunkFixture(file: string, text: string, status: FileDiffInfo['status'] = 'modified'): WalkthroughHunk {
  return {
    id: computeHunkId(file, status, text),
    file,
    status,
    header: text.split('\n')[0] ?? '',
    text,
    truncated: false,
  }
}

const THREE_HUNKS: FileDiffInfo[] = [
  change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
  change('src/b.ts', hunkPatch(1)),
]

const THREE_HUNK_IDS = [
  computeHunkId('src/a.ts', 'modified', hunkPatch(1)),
  computeHunkId('src/a.ts', 'modified', hunkPatch(10)),
  computeHunkId('src/b.ts', 'modified', hunkPatch(1)),
]

interface FakeSession {
  info?: SessionInfo | Error
  changes?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const generateCalls: string[] = []
  const generateModels: Array<ModelRef | undefined> = []
  let generateImpl: () => Promise<string> = async () => modelReply([])

  const client = {
    api: {
      ...stubLoadedModelCatalog(),
      session: {
        get: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          const config = sessions[sessionID]
          if (!config) {
            throw Object.assign(new Error('Session not found'), { _tag: 'SessionNotFoundError' })
          }
          if (config.info instanceof Error) {
            throw config.info
          }
          return config.info ?? ({ id: sessionID, title: `Title ${sessionID}` } as SessionInfo)
        }),
        diff: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          const config = sessions[sessionID]
          if (config?.changes instanceof Error) {
            throw config.changes
          }
          return config?.changes ?? []
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
      generate: {
        text: vi.fn(async (input: { prompt: string; model?: ModelRef }) => {
          generateCalls.push(input.prompt)
          generateModels.push(input.model)
          return { text: await generateImpl() }
        }),
      },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return {
    client,
    generateCalls,
    generateModels,
    setGenerateImpl: (impl: () => Promise<string>) => {
      generateImpl = impl
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

describe('computeChangesHash', () => {
  it('is stable for identical changes', () => {
    const changes = [change('src/a.ts', hunkPatch(1))]
    expect(computeChangesHash(changes)).toBe(computeChangesHash(changes))
  })

  it('changes when any field changes', () => {
    const base = change('src/a.ts', hunkPatch(1))
    expect(computeChangesHash([base])).not.toBe(computeChangesHash([change('src/a.ts', hunkPatch(2))]))
    expect(computeChangesHash([base])).not.toBe(computeChangesHash([change('src/b.ts', hunkPatch(1))]))
    expect(computeChangesHash([base])).not.toBe(
      computeChangesHash([change('src/a.ts', hunkPatch(1), 'added')]),
    )
  })

  it('is order sensitive', () => {
    const a = change('src/a.ts', hunkPatch(1))
    const b = change('src/b.ts', hunkPatch(1))
    expect(computeChangesHash([a, b])).not.toBe(computeChangesHash([b, a]))
  })
})

describe('isMechanicalChangePath', () => {
  it('matches lockfiles by basename', () => {
    const lockfiles = [
      'pnpm-lock.yaml',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
      'Cargo.lock',
      'Gemfile.lock',
      'composer.lock',
      'poetry.lock',
      'uv.lock',
      'Pipfile.lock',
      'go.sum',
      'flake.lock',
      'deep/nested/pnpm-lock.yaml',
    ]
    expect(lockfiles.every(isMechanicalChangePath)).toBe(true)
  })

  it('matches generated suffixes and snapshot directories', () => {
    expect(isMechanicalChangePath('src/__snapshots__/a.ts.snap')).toBe(true)
    expect(isMechanicalChangePath('src/__snapshots__/a.ts')).toBe(true)
    expect(isMechanicalChangePath('dist/bundle.min.js')).toBe(true)
    expect(isMechanicalChangePath('dist/app.min.css')).toBe(true)
    expect(isMechanicalChangePath('dist/bundle.js.map')).toBe(true)
  })

  it('does not match ordinary source and config files', () => {
    expect(isMechanicalChangePath('src/lock.ts')).toBe(false)
    expect(isMechanicalChangePath('package.json')).toBe(false)
    expect(isMechanicalChangePath('src/snapshots/a.ts')).toBe(false)
    expect(isMechanicalChangePath('src/map.ts')).toBe(false)
  })
})

describe('buildWalkthroughInput', () => {
  it('assigns a distinct content id and the file to each hunk', () => {
    const { hunks, omittedFiles } = buildWalkthroughInput(
      [
        change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
        change('src/b.ts', hunkPatch(1)),
      ],
      'My session',
    )

    expect(omittedFiles).toEqual([])
    expect(hunks.map((hunk) => hunk.file)).toEqual(['src/a.ts', 'src/a.ts', 'src/b.ts'])
    const ids = hunks.map((hunk) => hunk.id)
    expect(ids.every((id) => id.startsWith('h_'))).toBe(true)
    expect(new Set(ids).size).toBe(3)
  })

  it('keeps a hunk id when an earlier hunk in the file changes', () => {
    const before = buildWalkthroughInput(
      [
        change(
          'src/a.ts',
          '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n@@ -10,2 +10,2 @@\n-const b = 1;\n+const b = 2;',
        ),
      ],
      'My session',
    )
    const after = buildWalkthroughInput(
      [
        change(
          'src/a.ts',
          '@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;\n+const extra = 3;\n@@ -11,2 +11,2 @@\n-const b = 1;\n+const b = 2;',
        ),
      ],
      'My session',
    )

    expect(before.hunks).toHaveLength(2)
    expect(after.hunks).toHaveLength(2)
    expect(after.hunks[0]!.id).not.toBe(before.hunks[0]!.id)
    expect(after.hunks[1]!.id).toBe(before.hunks[1]!.id)
  })

  it('suffixes duplicate hunk content', () => {
    const { hunks } = buildWalkthroughInput(
      [change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(1)}`)],
      'My session',
    )

    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.id).not.toBe(hunks[1]!.id)
    expect(hunks[1]!.id).toBe(`${hunks[0]!.id}_2`)
  })

  it('omits files with no hunks as binary', () => {
    const { hunks, omittedFiles } = buildWalkthroughInput(
      [
        change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
        change('src/a.ts', hunkPatch(1)),
      ],
      'My session',
    )

    expect(hunks).toHaveLength(1)
    expect(omittedFiles).toEqual([{ file: 'assets/logo.png', reason: 'binary' }])
  })

  it('truncates an oversized hunk and marks it', () => {
    const longLine = `+${'x'.repeat(WALKTHROUGH_HUNK_MAX_CHARS + 100)}`
    const { hunks } = buildWalkthroughInput([change('src/a.ts', `@@ -1 +1 @@\n${longLine}`)], 'My session')

    expect(hunks[0]!.truncated).toBe(true)
    expect(hunks[0]!.text).toContain('[hunk truncated]')
  })

  it('bounds the included hunks and omits the remaining files as budget', () => {
    const changes = Array.from({ length: 10 }, (_, index) => change(`src/f${index}.ts`, bigHunk(index)))
    const { hunks, omittedFiles } = buildWalkthroughInput(changes, 'My session')

    const included = hunks.reduce((sum, hunk) => sum + hunk.text.length, 0)
    expect(included).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
    expect(omittedFiles.filter((file) => file.reason === 'budget').length).toBeGreaterThan(0)
    expect(omittedFiles.every((file) => file.reason === 'budget')).toBe(true)
  })

  it('never half-includes a file', () => {
    const patch = Array.from({ length: 9 }, (_, index) => bigHunk(index)).join('\n')
    const { hunks, omittedFiles } = buildWalkthroughInput([change('src/a.ts', patch)], 'My session')

    expect(hunks).toEqual([])
    expect(omittedFiles).toEqual([{ file: 'src/a.ts', reason: 'budget' }])
  })

  it('keeps the prompt within budget for many small hunks behind a very long path', () => {
    const longPath = `src/${'p'.repeat(996)}.ts`
    const manyHunks = Array.from(
      { length: 300 },
      (_, index) => `@@ -${index + 1} +${index + 1} @@\n+line${index}`,
    ).join('\n')
    const changes = [change('src/small.ts', hunkPatch(1)), change(longPath, manyHunks)]

    const { hunks, omittedFiles } = buildWalkthroughInput(changes, 'My session')
    const prompt = buildWalkthroughPrompt({ title: 'My session', hunks })

    expect(hunks.length).toBeGreaterThan(0)
    expect(prompt.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
    expect(omittedFiles).toEqual([{ file: longPath, reason: 'budget' }])
  })

  it('reserves the title in the budget so a long title admits less content', () => {
    const changes = Array.from({ length: 20 }, (_, index) => change(`src/f${index}.ts`, bigHunk(index)))
    const longTitle = 'T'.repeat(20_000)

    const withLongTitle = buildWalkthroughInput(changes, longTitle)
    const withShortTitle = buildWalkthroughInput(changes, 'short')

    expect(withLongTitle.hunks.length).toBeLessThan(withShortTitle.hunks.length)
    expect(
      buildWalkthroughPrompt({ title: longTitle, hunks: withLongTitle.hunks }).length,
    ).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('separates mechanical hunks from the prompt hunks', () => {
    const { hunks, mechanicalHunks, omittedFiles } = buildWalkthroughInput(
      [change('src/a.ts', hunkPatch(1)), change('pnpm-lock.yaml', hunkPatch(2))],
      'My session',
    )

    expect(hunks.map((hunk) => hunk.file)).toEqual(['src/a.ts'])
    expect(mechanicalHunks.map((hunk) => hunk.file)).toEqual(['pnpm-lock.yaml'])
    expect(omittedFiles).toEqual([])
  })

  it('keeps mechanical hunks out of the prompt budget', () => {
    const changes = [
      ...Array.from({ length: 10 }, (_, index) => change(`src/f${index}.ts`, bigHunk(index))),
      change('pnpm-lock.yaml', hunkPatch(1)),
    ]

    const { hunks, mechanicalHunks, omittedFiles } = buildWalkthroughInput(changes, 'My session')

    expect(hunks.length).toBeLessThan(changes.length - 1)
    expect(mechanicalHunks.map((hunk) => hunk.file)).toEqual(['pnpm-lock.yaml'])
    expect(omittedFiles.some((file) => file.file === 'pnpm-lock.yaml')).toBe(false)
  })

  it('omits a binary mechanical file as binary', () => {
    const { mechanicalHunks, omittedFiles } = buildWalkthroughInput(
      [change('pnpm-lock.yaml', 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\nBinary files differ')],
      'My session',
    )

    expect(mechanicalHunks).toEqual([])
    expect(omittedFiles).toEqual([{ file: 'pnpm-lock.yaml', reason: 'binary' }])
  })
})

describe('buildWalkthroughPrompt', () => {
  const hunks: WalkthroughHunk[] = [hunkFixture('src/a.ts', hunkPatch(1))]

  it('lists every hunk with its id, file and status in a diff block', () => {
    const prompt = buildWalkthroughPrompt({ title: 'My session', hunks })

    expect(prompt).toContain(`### ${hunks[0]!.id} src/a.ts (modified)`)
    expect(prompt).toContain('```diff')
    expect(prompt).toContain(hunkPatch(1))
    expect(prompt).toContain('My session')
  })

  it('states the stop limit and the response shape', () => {
    const prompt = buildWalkthroughPrompt({ title: 'My session', hunks })

    expect(prompt).toContain(`at most ${WALKTHROUGH_MAX_STOPS} stops`)
    expect(prompt).toContain('"stops"')
  })
})

describe('parseWalkthroughResponse', () => {
  const hunks: WalkthroughHunk[] = [
    hunkFixture('src/a.ts', hunkPatch(1)),
    hunkFixture('src/a.ts', hunkPatch(2)),
    hunkFixture('src/b.ts', hunkPatch(3)),
  ]
  const idA0 = hunks[0]!.id
  const idA1 = hunks[1]!.id
  const idB0 = hunks[2]!.id

  it('drops unknown ids and repeat references, first occurrence wins', () => {
    const parsed = parseWalkthroughResponse(
      modelReply([
        { title: 'A', explanation: 'first', hunkIds: [idA0, 'nope'] },
        { title: 'B', explanation: 'second', hunkIds: [idA0, idA1] },
      ]),
      hunks,
    )

    expect(parsed?.stops.map((stop) => stop.hunkIds)).toEqual([[idA0], [idA1], [idB0]])
  })

  it('drops stops left empty', () => {
    const parsed = parseWalkthroughResponse(
      modelReply([
        { title: 'A', explanation: 'first', hunkIds: ['nope'] },
        { title: 'B', explanation: 'second', hunkIds: [idA0, idA1, idB0] },
      ]),
      hunks,
    )

    expect(parsed?.stops.map((stop) => stop.title)).toEqual(['B'])
  })

  it('appends unreferenced hunks as a final remaining stop', () => {
    const parsed = parseWalkthroughResponse(
      modelReply([{ title: 'A', explanation: 'first', hunkIds: [idA0] }]),
      hunks,
    )

    expect(parsed?.stops.at(-1)).toEqual({
      id: computeStopId([idA1, idB0]),
      title: 'Remaining changes',
      explanation: 'These changes were not covered by the generated walkthrough.',
      hunkIds: [idA1, idB0],
      status: 'ready',
      explanationKey: null,
    })
  })

  it('does not append a remaining stop when every hunk is covered', () => {
    const parsed = parseWalkthroughResponse(
      modelReply([{ title: 'A', explanation: 'first', hunkIds: [idA0, idA1, idB0] }]),
      hunks,
    )

    expect(parsed?.stops).toHaveLength(1)
    expect(parsed?.stops[0]!.title).toBe('A')
  })

  it('caps model stops and text lengths', () => {
    const manyHunks: WalkthroughHunk[] = Array.from(
      { length: WALKTHROUGH_MAX_STOPS + 5 },
      (_, index) => hunkFixture('src/a.ts', hunkPatch(index)),
    )
    const stops = manyHunks.map((hunk, index) => ({
      title: `Stop ${index}`,
      explanation: 'e'.repeat(WALKTHROUGH_TEXT_MAX_CHARS + 50),
      hunkIds: [hunk.id],
    }))
    const parsed = parseWalkthroughResponse(
      modelReply(stops, 's'.repeat(WALKTHROUGH_TEXT_MAX_CHARS + 50)),
      manyHunks,
    )

    const modelStops = parsed!.stops.filter((stop) => stop.title !== 'Remaining changes')
    expect(modelStops).toHaveLength(WALKTHROUGH_MAX_STOPS)
    expect(parsed!.summary.length).toBeLessThanOrEqual(WALKTHROUGH_TEXT_MAX_CHARS)
    expect(modelStops[0]!.explanation.length).toBeLessThanOrEqual(WALKTHROUGH_TEXT_MAX_CHARS)
  })

  it('returns null when the response is unparseable', () => {
    expect(parseWalkthroughResponse('not json at all', hunks)).toBeNull()
    expect(parseWalkthroughResponse('{not json', hunks)).toBeNull()
    expect(parseWalkthroughResponse('{"summary":"x"}', hunks)).toBeNull()
  })

  it('returns null when no model stop survives', () => {
    expect(parseWalkthroughResponse(modelReply([{ title: 'A', explanation: 'x', hunkIds: ['nope'] }]), hunks)).toBeNull()
  })
})

describe('ChangeWalkthroughService', () => {
  let db: Database
  let sessions: Record<string, FakeSession>
  let fake: ReturnType<typeof createFakeClient>
  let service: ChangeWalkthroughService

  const threeHunks: FileDiffInfo[] = THREE_HUNKS

  beforeEach(() => {
    db = createTestDb()
    sessions = { [SESSION_ID]: { changes: threeHunks } }
    fake = createFakeClient(sessions)
    service = new ChangeWalkthroughService(db, fake.client)
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
    expect(state.currentDiffHash).toBe(computeChangesHash(threeHunks))
    expect(state.generating).toBe(false)
    expect(state.error).toBeNull()
  })

  it('reports stale when the changes differ from the stored hash', async () => {
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))
    await service.generate(SESSION_ID, {})

    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]

    const state = await service.getState(SESSION_ID)
    expect(state.stale).toBe(true)
    expect(state.currentDiffHash).toBe(computeChangesHash([change('src/a.ts', hunkPatch(99))]))
  })

  it('reports a null current hash when changes cannot be read', async () => {
    sessions[SESSION_ID]!.changes = new Error('diff failed')

    const state = await service.getState(SESSION_ID)
    expect(state.currentDiffHash).toBeNull()
    expect(state.stale).toBe(false)
  })

  it('does not read changes while generating', async () => {
    let resolveGenerate: (text: string) => void = () => {}
    fake.setGenerateImpl(() => new Promise<string>((resolve) => {
      resolveGenerate = resolve
    }))

    const pending = service.generate(SESSION_ID, {})
    await vi.waitFor(() => expect(fake.generateCalls).toHaveLength(1))

    const diff = vi.mocked(fake.client.api.session.diff)
    const messages = vi.mocked(fake.client.api.message.list)
    const diffCalls = diff.mock.calls.length
    const messageCalls = messages.mock.calls.length

    await service.getState(SESSION_ID)
    await service.getState(SESSION_ID)

    expect(diff.mock.calls.length).toBe(diffCalls)
    expect(messages.mock.calls.length).toBe(messageCalls)

    resolveGenerate(modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))
    await pending
  })

  it('caches the current hash until a session execution event', async () => {
    await service.getState(SESSION_ID)
    await service.getState(SESSION_ID)

    expect(vi.mocked(fake.client.api.session.diff)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fake.client.api.message.list)).toHaveBeenCalledTimes(2)
  })

  it('recomputes the hash after session.execution.succeeded', async () => {
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))
    await service.generate(SESSION_ID, {})

    await service.getState(SESSION_ID)
    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(99))]

    const cached = await service.getState(SESSION_ID)
    expect(cached.stale).toBe(false)

    service.handleEvent(sessionEvent('session.execution.succeeded', SESSION_ID))

    const refreshed = await service.getState(SESSION_ID)
    expect(refreshed.stale).toBe(true)
    expect(refreshed.currentDiffHash).toBe(computeChangesHash([change('src/a.ts', hunkPatch(99))]))
  })

  it('stores stops covering every hunk exactly once', async () => {
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: [THREE_HUNK_IDS[0]!, THREE_HUNK_IDS[2]!] }]))

    const { walkthrough, created } = await service.generate(SESSION_ID, {})

    expect(created).toBe(true)
    const ids = walkthrough.stops.flatMap((stop) => stop.hunkIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(THREE_HUNK_IDS))
    expect(walkthrough.stops.at(-1)!.title).toBe('Remaining changes')
  })

  it('keeps mechanical hunks out of the prompt and appends a mechanical stop', async () => {
    const lockText = hunkPatch(7)
    sessions[SESSION_ID]!.changes = [change('src/a.ts', hunkPatch(1)), change('pnpm-lock.yaml', lockText)]
    fake.setGenerateImpl(async () =>
      modelReply([{ title: 'A', explanation: 'x', hunkIds: [computeHunkId('src/a.ts', 'modified', hunkPatch(1))] }]),
    )

    const { walkthrough } = await service.generate(SESSION_ID, {})

    expect(fake.generateCalls).toHaveLength(1)
    expect(fake.generateCalls[0]).not.toContain('pnpm-lock.yaml')
    const mechanical = walkthrough.stops.at(-1)!
    expect(mechanical.title).toBe('Mechanical changes')
    expect(mechanical.hunkIds).toEqual([computeHunkId('pnpm-lock.yaml', 'modified', lockText)])

    const referenced = walkthrough.stops.flatMap((stop) => stop.hunkIds)
    expect(new Set(referenced).size).toBe(referenced.length)
    expect(new Set(referenced)).toEqual(new Set(walkthrough.hunks.map((hunk) => hunk.id)))
  })

  it('stores only a mechanical stop without a model call', async () => {
    sessions[SESSION_ID]!.changes = [
      change('pnpm-lock.yaml', hunkPatch(1)),
      change('src/__snapshots__/a.ts.snap', hunkPatch(2)),
    ]

    const { walkthrough, created } = await service.generate(SESSION_ID, {})

    expect(created).toBe(true)
    expect(fake.generateCalls).toHaveLength(0)
    expect(walkthrough.summary).toBe('Only lock files, snapshots or generated files changed.')
    expect(walkthrough.stops).toHaveLength(1)
    expect(walkthrough.stops[0]!.title).toBe('Mechanical changes')
    expect(walkthrough.stops[0]!.hunkIds).toHaveLength(2)
    expect(new Set(walkthrough.stops[0]!.hunkIds)).toEqual(
      new Set(walkthrough.hunks.map((hunk) => hunk.id)),
    )
  })

  it('returns the stored walkthrough without a model call when changes are unchanged', async () => {
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))
    const first = await service.generate(SESSION_ID, {})

    const second = await service.generate(SESSION_ID, {})

    expect(second.created).toBe(false)
    expect(second.walkthrough).toEqual(first.walkthrough)
    expect(fake.generateCalls).toHaveLength(1)
  })

  it('calls the model again when regenerate is set', async () => {
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))
    await service.generate(SESSION_ID, {})

    await service.generate(SESSION_ID, { regenerate: true })

    expect(fake.generateCalls).toHaveLength(2)
  })

  it('generates with the session selected model', async () => {
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    } as SessionInfo
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))

    await service.generate(SESSION_ID, {})

    expect(fake.generateModels[0]).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-4' })
  })

  it('falls back to the resolved default when the session has no model', async () => {
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))

    await service.generate(SESSION_ID, {})

    expect(fake.generateModels[0]).toEqual({ providerID: 'openai', id: 'gpt-5-mini' })
  })

  it('coalesces concurrent generation into one model call', async () => {
    let resolveGenerate: (text: string) => void = () => {}
    const gate = new Promise<string>((resolve) => {
      resolveGenerate = resolve
    })
    fake.setGenerateImpl(() => gate)

    const first = service.generate(SESSION_ID, {})
    const second = service.generate(SESSION_ID, {})
    resolveGenerate(modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toBe(secondResult)
    expect(fake.generateCalls).toHaveLength(1)
  })

  it('rejects with 409 when the session has no changes', async () => {
    sessions[SESSION_ID]!.changes = []

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 409,
      code: 'WALKTHROUGH_NO_CHANGES',
    })
  })

  it('rejects with 409 when every change is binary', async () => {
    sessions[SESSION_ID]!.changes = [
      change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
    ]

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 409,
      code: 'WALKTHROUGH_NO_TEXT_CHANGES',
    })
  })

  it('rejects with 413 and the omitted files when a text file exceeds the context budget', async () => {
    const file = 'src/huge.ts'
    const patch = Array.from({ length: 10 }, (_, index) => bigHunk(index)).join('\n')
    sessions[SESSION_ID]!.changes = [change(file, patch)]

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 413,
      code: 'WALKTHROUGH_CONTEXT_LIMIT',
      details: { omittedFiles: [{ file, reason: 'budget' }] },
    })
    expect(fake.generateCalls).toHaveLength(0)
  })

  it('rejects with 502 when the model response is unparseable', async () => {
    fake.setGenerateImpl(async () => 'not json')

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 502,
      code: 'WALKTHROUGH_UNPARSEABLE',
    })
  })

  it('rejects with 504 when generation times out', async () => {
    const timingOut = new ChangeWalkthroughService(db, fake.client, { timeoutMs: 5 })
    fake.setGenerateImpl(() => new Promise<string>(() => {}))

    await expect(timingOut.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 504,
      code: 'WALKTHROUGH_TIMEOUT',
    })
  })

  it('rejects with 502 when the model call fails', async () => {
    fake.setGenerateImpl(async () => {
      throw new Error('model unavailable')
    })

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({ status: 502 })
  })

  it('rejects with 502 when reading changes fails', async () => {
    sessions[SESSION_ID]!.changes = new Error('diff failed')

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 502,
      code: 'WALKTHROUGH_CHANGES_UNAVAILABLE',
    })
  })

  it('rejects with 404 when generating for a missing session', async () => {
    await expect(service.generate('ses_missing', {})).rejects.toBeInstanceOf(ChangeWalkthroughError)
    await expect(service.generate('ses_missing', {})).rejects.toMatchObject({ status: 404 })
  })

  describe('startGeneration', () => {
    const coveringReply = modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }])

    it('reports generating while the model call is pending, then the stored walkthrough', async () => {
      let resolveGenerate: (text: string) => void = () => {}
      fake.setGenerateImpl(() => new Promise<string>((resolve) => {
        resolveGenerate = resolve
      }))

      const state = await service.startGeneration(SESSION_ID, {})
      expect(state.generating).toBe(true)
      expect(state.walkthrough).toBeNull()
      expect(state.error).toBeNull()

      await vi.waitFor(() => expect(fake.generateCalls).toHaveLength(1))
      resolveGenerate(coveringReply)

      await vi.waitFor(async () => {
        const settled = await service.getState(SESSION_ID)
        expect(settled.generating).toBe(false)
        expect(settled.walkthrough).not.toBeNull()
      })
    })

    it('stores a mechanical-only walkthrough without a model call', async () => {
      sessions[SESSION_ID]!.changes = [change('pnpm-lock.yaml', hunkPatch(1))]

      const state = await service.startGeneration(SESSION_ID, {})

      expect(fake.generateCalls).toHaveLength(0)
      expect(state.generating).toBe(false)
      expect(state.walkthrough?.stops).toHaveLength(1)
      expect(state.walkthrough?.stops[0]!.title).toBe('Mechanical changes')
    })

    it('rejects with 409 when the session has no changes', async () => {
      sessions[SESSION_ID]!.changes = []

      await expect(service.startGeneration(SESSION_ID, {})).rejects.toMatchObject({
        status: 409,
        code: 'WALKTHROUGH_NO_CHANGES',
      })
      sessions[SESSION_ID]!.changes = threeHunks
      expect((await service.getState(SESSION_ID)).error).toBeNull()
    })

    it('records an unparseable model failure on the state', async () => {
      fake.setGenerateImpl(async () => 'not json')

      await service.startGeneration(SESSION_ID, {})

      await vi.waitFor(async () => {
        const settled = await service.getState(SESSION_ID)
        expect(settled.generating).toBe(false)
        expect(settled.error).toMatchObject({ code: 'WALKTHROUGH_UNPARSEABLE' })
      })
    })

    it('clears a previous error when a new generation starts', async () => {
      fake.setGenerateImpl(async () => 'not json')
      await service.startGeneration(SESSION_ID, {})
      await vi.waitFor(async () => {
        expect((await service.getState(SESSION_ID)).error).not.toBeNull()
      })

      fake.setGenerateImpl(() => new Promise<string>(() => {}))
      const state = await service.startGeneration(SESSION_ID, { regenerate: true })

      expect(state.generating).toBe(true)
      expect(state.error).toBeNull()
    })

    it('clears the recorded error when the session is deleted', async () => {
      fake.setGenerateImpl(async () => 'not json')
      await service.startGeneration(SESSION_ID, {})
      await vi.waitFor(async () => {
        expect((await service.getState(SESSION_ID)).error).not.toBeNull()
      })

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      expect((await service.getState(SESSION_ID)).error).toBeNull()
    })
  })

  describe('handleEvent', () => {
    const coveringReply = modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }])

    it('deletes the stored walkthrough when its session is deleted', async () => {
      fake.setGenerateImpl(async () => coveringReply)
      await service.generate(SESSION_ID, {})

      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))

      expect(getChangeWalkthrough(db, SESSION_ID)).toBeNull()
    })

    it('keeps the stored walkthrough for other session events', async () => {
      fake.setGenerateImpl(async () => coveringReply)
      await service.generate(SESSION_ID, {})

      service.handleEvent(sessionEvent('session.execution.succeeded', SESSION_ID))
      service.handleEvent(sessionEvent('session.deleted', 'ses_other'))

      expect(getChangeWalkthrough(db, SESSION_ID)).not.toBeNull()
    })

    it('does not store a walkthrough whose session was deleted during generation', async () => {
      let resolveGenerate: (text: string) => void = () => {}
      fake.setGenerateImpl(() => new Promise<string>((resolve) => {
        resolveGenerate = resolve
      }))

      const pending = service.generate(SESSION_ID, {})
      await vi.waitFor(() => expect(fake.generateCalls).toHaveLength(1))
      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))
      resolveGenerate(coveringReply)

      await expect(pending).rejects.toMatchObject({ status: 404 })
      expect(getChangeWalkthrough(db, SESSION_ID)).toBeNull()
    })

    it('stores walkthroughs again after an earlier deletion of the same session id', async () => {
      service.handleEvent(sessionEvent('session.deleted', SESSION_ID))
      fake.setGenerateImpl(async () => coveringReply)

      await service.generate(SESSION_ID, {})

      expect(getChangeWalkthrough(db, SESSION_ID)).not.toBeNull()
    })
  })
})
