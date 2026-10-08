import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import type { FileDiffInfo, ModelRef, SessionInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import {
  WALKTHROUGH_DIFF_MAX_CHARS,
  WALKTHROUGH_HUNK_MAX_CHARS,
  WALKTHROUGH_MAX_STOPS,
  WALKTHROUGH_OUTLINE_LINE_MAX_CHARS,
  WALKTHROUGH_OUTLINE_PREVIEW_LINES,
  WALKTHROUGH_TEXT_MAX_CHARS,
  type WalkthroughHunk,
} from '@opencode-manager/shared/schemas'
import { getChangeWalkthrough } from '../../src/db/change-walkthroughs'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { SettingsService } from '../../src/services/settings'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import { stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import {
  ChangeWalkthroughError,
  ChangeWalkthroughService,
  buildWalkthroughInput,
  buildWalkthroughOutline,
  buildWalkthroughPlanPrompt,
  buildWalkthroughPrompt,
  computeChangesHash,
  computeHunkId,
  computeStopId,
  fitsSingleCall,
  formatHunkOutline,
  isMechanicalChangePath,
  parseWalkthroughPlan,
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
  return `@@ -${index},1 +${index},1 @@\n+${'x'.repeat(size)}_${index}`
}

function longHunk(index: number): string {
  const lines = Array.from(
    { length: 6 },
    (_, line) => `+${'x'.repeat(200)}_${index}_${line}`,
  )
  return `@@ -${index + 1},6 +${index + 1},6 @@\n${lines.join('\n')}`
}

function longPatch(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, index) => longHunk(offset + index)).join('\n')
}

function modelReply(
  stops: Array<{ title: string; explanation: string; hunkIds: string[] }>,
  summary = 'Summary',
): string {
  return JSON.stringify({ summary, stops })
}

function planReply(
  stops: Array<{ title: string; hunkIds: string[] }>,
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

const PLAN_MARKER = 'Assign every hunk id'
const EXPLANATION_REPLY = JSON.stringify({ explanation: 'Why' })

const LARGE_CHANGES: FileDiffInfo[] = [
  change('src/a.ts', [0, 1, 2, 3].map((index) => bigHunk(index)).join('\n')),
  change('src/b.ts', [10, 11, 12, 13].map((index) => bigHunk(index)).join('\n')),
  change('src/c.ts', [20, 21, 22, 23].map((index) => bigHunk(index)).join('\n')),
]

const LARGE_PLAN_REPLY = planReply([
  { title: 'A', hunkIds: [0, 1, 2, 3].map((index) => computeHunkId('src/a.ts', 'modified', bigHunk(index))) },
  { title: 'B', hunkIds: [10, 11, 12, 13].map((index) => computeHunkId('src/b.ts', 'modified', bigHunk(index))) },
  { title: 'C', hunkIds: [20, 21, 22, 23].map((index) => computeHunkId('src/c.ts', 'modified', bigHunk(index))) },
])

const EDITED_A_HUNKS = [0, 1, 2, 3].map((index) => bigHunk(index, WALKTHROUGH_HUNK_MAX_CHARS - 10))

const EDITED_LARGE_CHANGES: FileDiffInfo[] = [
  change('src/a.ts', EDITED_A_HUNKS.join('\n')),
  change('src/b.ts', [10, 11, 12, 13].map((index) => bigHunk(index)).join('\n')),
  change('src/c.ts', [20, 21, 22, 23].map((index) => bigHunk(index)).join('\n')),
]

const EDITED_LARGE_PLAN_REPLY = planReply([
  { title: 'A', hunkIds: EDITED_A_HUNKS.map((hunk) => computeHunkId('src/a.ts', 'modified', hunk)) },
  { title: 'B', hunkIds: [10, 11, 12, 13].map((index) => computeHunkId('src/b.ts', 'modified', bigHunk(index))) },
  { title: 'C', hunkIds: [20, 21, 22, 23].map((index) => computeHunkId('src/c.ts', 'modified', bigHunk(index))) },
])

function explanationFor(prompt: string): string {
  const title = prompt.match(/## Stop: (.+)/)?.[1] ?? ''
  return JSON.stringify({ explanation: `explained-${title}` })
}

interface FakeSession {
  info?: SessionInfo | Error
  changes?: FileDiffInfo[] | Error
}

function createFakeClient(sessions: Record<string, FakeSession>) {
  const generateCalls: string[] = []
  const generateModels: Array<ModelRef | undefined> = []
  let generateImpl: (prompt: string) => Promise<string> = async () => modelReply([])

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
          return { text: await generateImpl(input.prompt) }
        }),
      },
    },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return {
    client,
    generateCalls,
    generateModels,
    setGenerateImpl: (impl: (prompt: string) => Promise<string>) => {
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
    const { hunks, omittedFiles } = buildWalkthroughInput([
      change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
      change('src/b.ts', hunkPatch(1)),
    ])

    expect(omittedFiles).toEqual([])
    expect(hunks.map((hunk) => hunk.file)).toEqual(['src/a.ts', 'src/a.ts', 'src/b.ts'])
    const ids = hunks.map((hunk) => hunk.id)
    expect(ids.every((id) => id.startsWith('h_'))).toBe(true)
    expect(new Set(ids).size).toBe(3)
  })

  it('keeps a hunk id when an earlier hunk in the file changes', () => {
    const before = buildWalkthroughInput([
      change(
        'src/a.ts',
        '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n@@ -10,2 +10,2 @@\n-const b = 1;\n+const b = 2;',
      ),
    ])
    const after = buildWalkthroughInput([
      change(
        'src/a.ts',
        '@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;\n+const extra = 3;\n@@ -11,2 +11,2 @@\n-const b = 1;\n+const b = 2;',
      ),
    ])

    expect(before.hunks).toHaveLength(2)
    expect(after.hunks).toHaveLength(2)
    expect(after.hunks[0]!.id).not.toBe(before.hunks[0]!.id)
    expect(after.hunks[1]!.id).toBe(before.hunks[1]!.id)
  })

  it('suffixes duplicate hunk content', () => {
    const { hunks } = buildWalkthroughInput([change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(1)}`)])

    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.id).not.toBe(hunks[1]!.id)
    expect(hunks[1]!.id).toBe(`${hunks[0]!.id}_2`)
  })

  it('omits files with no hunks as binary', () => {
    const { hunks, omittedFiles } = buildWalkthroughInput([
      change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
      change('src/a.ts', hunkPatch(1)),
    ])

    expect(hunks).toHaveLength(1)
    expect(omittedFiles).toEqual([{ file: 'assets/logo.png', reason: 'binary' }])
  })

  it('truncates an oversized hunk and marks it', () => {
    const longLine = `+${'x'.repeat(WALKTHROUGH_HUNK_MAX_CHARS + 100)}`
    const { hunks } = buildWalkthroughInput([change('src/a.ts', `@@ -1 +1 @@\n${longLine}`)])

    expect(hunks[0]!.truncated).toBe(true)
    expect(hunks[0]!.text).toContain('[hunk truncated]')
  })

  it('separates mechanical hunks from the prompt hunks', () => {
    const { hunks, mechanicalHunks, omittedFiles } = buildWalkthroughInput([
      change('src/a.ts', hunkPatch(1)),
      change('pnpm-lock.yaml', hunkPatch(2)),
    ])

    expect(hunks.map((hunk) => hunk.file)).toEqual(['src/a.ts'])
    expect(mechanicalHunks.map((hunk) => hunk.file)).toEqual(['pnpm-lock.yaml'])
    expect(omittedFiles).toEqual([])
  })

  it('omits a binary mechanical file as binary', () => {
    const { mechanicalHunks, omittedFiles } = buildWalkthroughInput([
      change('pnpm-lock.yaml', 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\nBinary files differ'),
    ])

    expect(mechanicalHunks).toEqual([])
    expect(omittedFiles).toEqual([{ file: 'pnpm-lock.yaml', reason: 'binary' }])
  })
})

describe('buildWalkthroughOutline', () => {
  const smallChange = (index: number) => change(`src/f${index}.ts`, hunkPatch(index))

  it('fits 300 small files and lists every hunk id', () => {
    const input = buildWalkthroughInput(Array.from({ length: 300 }, (_, index) => smallChange(index)))
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 'My session')

    expect(omittedFiles).toEqual([])
    expect(hunks).toHaveLength(300)
    for (const hunk of input.hunks) {
      expect(outline).toContain(hunk.id)
    }
    expect(fitsSingleCall(input, 'My session')).toBe(true)
    expect(
      buildWalkthroughPlanPrompt({ title: 'My session', outline, previousStops: [] }).length,
    ).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('omits trailing files as budget and never half-includes a file', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 120 }, (_, index) => change(`src/f${index}.ts`, longPatch(3, index * 3))),
    )
    const { omittedFiles, outline } = buildWalkthroughOutline(input, 'My session')

    expect(omittedFiles.some((file) => file.reason === 'budget')).toBe(true)

    const idsByFile = new Map<string, string[]>()
    for (const hunk of input.hunks) {
      const ids = idsByFile.get(hunk.file) ?? []
      ids.push(hunk.id)
      idsByFile.set(hunk.file, ids)
    }

    const includedFiles = new Set<string>()
    for (const [file, ids] of idsByFile) {
      const present = ids.filter((id) => outline.includes(id)).length
      expect(present === 0 || present === ids.length).toBe(true)
      if (present > 0) {
        includedFiles.add(file)
      }
    }

    expect(omittedFiles.map((file) => file.file)).toEqual(
      [...idsByFile.keys()].filter((file) => !includedFiles.has(file)),
    )
  })

  it('falls back to header-only outlines when a single file does not fit at the default preview depth', () => {
    const input = buildWalkthroughInput([change('src/huge.ts', longPatch(100))])
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 'My session')

    expect(hunks).toHaveLength(100)
    expect(omittedFiles).toEqual([])
    for (const hunk of input.hunks) {
      expect(outline).toContain(hunk.id)
    }
  })

  it('keeps mechanical hunks out of the outline', () => {
    const input = buildWalkthroughInput([
      change('src/a.ts', hunkPatch(1)),
      change('pnpm-lock.yaml', hunkPatch(2)),
    ])
    const { omittedFiles, outline } = buildWalkthroughOutline(input, 'My session')

    expect(input.mechanicalHunks).toHaveLength(1)
    expect(outline).not.toContain(input.mechanicalHunks[0]!.id)
    expect(outline).not.toContain('pnpm-lock.yaml')
    expect(omittedFiles).toEqual([])
  })

  it('reserves the title in the budget so a long title admits less content', () => {
    const input = buildWalkthroughInput(Array.from({ length: 500 }, (_, index) => smallChange(index)))
    const longTitle = 'T'.repeat(20_000)

    const withLongTitle = buildWalkthroughOutline(input, longTitle)
    const withShortTitle = buildWalkthroughOutline(input, 'short')

    expect(withShortTitle.omittedFiles).toEqual([])
    expect(withLongTitle.hunks.length).toBeLessThan(withShortTitle.hunks.length)
    expect(
      buildWalkthroughPlanPrompt({
        title: longTitle,
        outline: withLongTitle.outline,
        previousStops: [],
      }).length,
    ).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('bounds the included hunks and omits the remaining files as budget', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 40 }, (_, index) => change(`src/f${index}.ts`, longPatch(6, index * 6))),
    )
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 'My session')

    expect(hunks.length).toBeLessThan(input.hunks.length)
    expect(omittedFiles.filter((file) => file.reason === 'budget').length).toBeGreaterThan(0)
    expect(omittedFiles.every((file) => file.reason === 'budget')).toBe(true)
    expect(outline.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('never half-includes a file', () => {
    const input = buildWalkthroughInput([
      change('src/small.ts', hunkPatch(1)),
      change('src/huge.ts', longPatch(100)),
    ])
    const { outline } = buildWalkthroughOutline(input, 'My session')

    const hugeIds = input.hunks.filter((hunk) => hunk.file === 'src/huge.ts').map((hunk) => hunk.id)
    expect(hugeIds.length).toBeGreaterThan(0)
    expect(hugeIds.every((id) => !outline.includes(id))).toBe(true)
  })

  it('keeps the outline within budget for many small hunks behind a very long path', () => {
    const longPath = `src/${'p'.repeat(996)}.ts`
    const manyHunks = Array.from(
      { length: 300 },
      (_, index) => `@@ -${index + 1} +${index + 1} @@\n+line${index}`,
    ).join('\n')
    const input = buildWalkthroughInput([
      change('src/small.ts', hunkPatch(1)),
      change(longPath, manyHunks),
    ])
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 'My session')

    expect(hunks.length).toBeGreaterThan(0)
    expect(omittedFiles).toEqual([{ file: longPath, reason: 'budget' }])
    expect(
      buildWalkthroughPlanPrompt({ title: 'My session', outline, previousStops: [] }).length,
    ).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })
})

describe('formatHunkOutline', () => {
  it('renders the id, file, status, header and change counts', () => {
    const hunk = hunkFixture('src/a.ts', '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;')
    const [first] = formatHunkOutline(hunk).split('\n')

    expect(first).toBe(`### ${hunk.id} src/a.ts (modified) @@ -1,2 +1,2 @@ +1 -1`)
  })

  it('lists at most the preview line count of changed lines, skipping file headers', () => {
    const hunk = hunkFixture(
      'src/a.ts',
      '@@ -1,4 +1,4 @@\n--- a/x\n+++ b/x\n-const a = 1;\n+const a = 2;\n-const b = 1;\n+const b = 2;',
    )

    const single = formatHunkOutline(hunk, 1).split('\n')
    expect(single).toHaveLength(2)
    expect(single[1]!.startsWith('---')).toBe(false)
    expect(single[1]!.startsWith('+++')).toBe(false)
    expect(single[1]).toBe('-const a = 1;')

    const full = formatHunkOutline(hunk).split('\n')
    expect(full).toContain('-const a = 1;')
    expect(full).toContain('+const a = 2;')
    expect(full).toContain('-const b = 1;')
    expect(full).toContain('+const b = 2;')
  })

  it('defaults to the shared preview line count', () => {
    const text = `@@ -1,8 +1,8 @@\n${Array.from({ length: 8 }, (_, index) => `+line${index}`).join('\n')}`
    const hunk = hunkFixture('src/a.ts', text)

    expect(formatHunkOutline(hunk).split('\n')).toHaveLength(1 + WALKTHROUGH_OUTLINE_PREVIEW_LINES)
  })

  it('truncates a long changed line to the line max', () => {
    const hunk = hunkFixture('src/a.ts', `@@ -1 +1 @@\n+${'x'.repeat(200)}`)
    const line = formatHunkOutline(hunk).split('\n')[1]!

    expect(line).toHaveLength(WALKTHROUGH_OUTLINE_LINE_MAX_CHARS)
  })
})

describe('buildWalkthroughPlanPrompt', () => {
  const outline = '### h_1 src/a.ts (modified) @@ -1 +1 @@ +1 -1\n+const a = 2;'

  it('contains the preamble, the plan rules and the outline', () => {
    const prompt = buildWalkthroughPlanPrompt({ title: 'My session', outline, previousStops: [] })

    expect(prompt).toContain('My session')
    expect(prompt).toContain('Assign every hunk id')
    expect(prompt).toContain(`at most ${WALKTHROUGH_MAX_STOPS} stops`)
    expect(prompt).toContain(outline)
  })

  it('lists previous stops when given', () => {
    const prompt = buildWalkthroughPlanPrompt({
      title: 'My session',
      outline,
      previousStops: [{ title: 'A', hunkIds: ['h_1'] }],
    })

    expect(prompt).toContain('Previous stops')
    expect(prompt).toContain('A: h_1')
  })

  it('drops previous stops when they would push the prompt over the diff budget', () => {
    const prompt = buildWalkthroughPlanPrompt({
      title: 'My session',
      outline,
      previousStops: [{ title: 'T'.repeat(WALKTHROUGH_DIFF_MAX_CHARS), hunkIds: ['h_1'] }],
    })

    expect(prompt).not.toContain('Previous stops')
    expect(prompt).toContain(outline)
    expect(prompt.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })
})

describe('parseWalkthroughPlan', () => {
  const hunks: WalkthroughHunk[] = [
    hunkFixture('src/a.ts', hunkPatch(1)),
    hunkFixture('src/a.ts', hunkPatch(2)),
    hunkFixture('src/b.ts', hunkPatch(3)),
  ]
  const idA0 = hunks[0]!.id
  const idA1 = hunks[1]!.id
  const idB0 = hunks[2]!.id

  it('drops unknown ids and repeat references, first occurrence wins', () => {
    const parsed = parseWalkthroughPlan(
      planReply([
        { title: 'A', hunkIds: [idA0, 'nope'] },
        { title: 'B', hunkIds: [idA0, idA1] },
      ]),
      hunks,
    )

    expect(parsed?.stops.map((stop) => stop.hunkIds)).toEqual([[idA0], [idA1], [idB0]])
  })

  it('drops stops left empty', () => {
    const parsed = parseWalkthroughPlan(
      planReply([
        { title: 'A', hunkIds: ['nope'] },
        { title: 'B', hunkIds: [idA0, idA1, idB0] },
      ]),
      hunks,
    )

    expect(parsed?.stops.map((stop) => stop.title)).toEqual(['B'])
  })

  it('appends unreferenced hunks as a pending remaining stop', () => {
    const parsed = parseWalkthroughPlan(planReply([{ title: 'A', hunkIds: [idA0] }]), hunks)

    expect(parsed?.stops.at(-1)).toEqual({
      id: computeStopId([idA1, idB0]),
      title: 'Remaining changes',
      explanation: '',
      hunkIds: [idA1, idB0],
      status: 'pending',
      explanationKey: null,
    })
  })

  it('does not append a remaining stop when every hunk is covered', () => {
    const parsed = parseWalkthroughPlan(
      planReply([{ title: 'A', hunkIds: [idA0, idA1, idB0] }]),
      hunks,
    )

    expect(parsed?.stops).toHaveLength(1)
    expect(parsed?.stops[0]!.title).toBe('A')
  })

  it('caps model stops at 20 and truncates titles', () => {
    const manyHunks: WalkthroughHunk[] = Array.from(
      { length: WALKTHROUGH_MAX_STOPS + 5 },
      (_, index) => hunkFixture('src/a.ts', hunkPatch(index)),
    )
    const stops = manyHunks.map((hunk) => ({
      title: 't'.repeat(WALKTHROUGH_TEXT_MAX_CHARS + 50),
      hunkIds: [hunk.id],
    }))
    const parsed = parseWalkthroughPlan(planReply(stops), manyHunks)

    const modelStops = parsed!.stops.filter((stop) => stop.title !== 'Remaining changes')
    expect(modelStops).toHaveLength(WALKTHROUGH_MAX_STOPS)
    expect(modelStops[0]!.title.length).toBeLessThanOrEqual(WALKTHROUGH_TEXT_MAX_CHARS)
  })

  it('marks model stops pending with an empty explanation', () => {
    const parsed = parseWalkthroughPlan(
      planReply([
        { title: 'A', hunkIds: [idA0] },
        { title: 'B', hunkIds: [idA1] },
      ]),
      hunks,
    )

    expect(parsed!.stops.every((stop) => stop.status === 'pending')).toBe(true)
    expect(parsed!.stops.every((stop) => stop.explanation === '')).toBe(true)
  })

  it('returns null when the response is unparseable', () => {
    expect(parseWalkthroughPlan('not json at all', hunks)).toBeNull()
    expect(parseWalkthroughPlan('{not json', hunks)).toBeNull()
    expect(parseWalkthroughPlan('{"summary":"x"}', hunks)).toBeNull()
  })

  it('returns null when no model stop survives', () => {
    expect(parseWalkthroughPlan(planReply([{ title: 'A', hunkIds: ['nope'] }]), hunks)).toBeNull()
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
    service = new ChangeWalkthroughService(db, fake.client, new SettingsService(db))
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

  it('uses the walkthrough model preference', async () => {
    new SettingsService(db).updateSettings({ walkthroughModel: 'openai/gpt-5-mini' })
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))

    const { walkthrough } = await service.generate(SESSION_ID, {})

    expect(fake.generateModels.every((model) => model?.providerID === 'openai' && model.id === 'gpt-5-mini')).toBe(true)
    expect(fake.generateModels.length).toBeGreaterThan(0)
    expect(walkthrough.model).toBe('openai/gpt-5-mini')
  })

  it('ignores an invalid walkthrough model preference', async () => {
    new SettingsService(db).updateSettings({ walkthroughModel: 'not-a-ref' })
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    } as SessionInfo
    fake.setGenerateImpl(async () => modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]))

    await service.generate(SESSION_ID, {})

    expect(fake.generateModels[0]).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-4' })
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

  it('rejects with 413 and the omitted files when the outline admits no hunk', async () => {
    const file = 'src/huge.ts'
    const patch = Array.from(
      { length: 2000 },
      (_, index) => `@@ -${index + 1},1 +${index + 1},1 @@\n+line${index}`,
    ).join('\n')
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
    expect(fake.generateCalls).toHaveLength(2)
  })

  it('rejects with 504 when generation times out', async () => {
    const timingOut = new ChangeWalkthroughService(db, fake.client, new SettingsService(db), { timeoutMs: 5 })
    fake.setGenerateImpl(() => new Promise<string>(() => {}))

    await expect(timingOut.generate(SESSION_ID, {})).rejects.toMatchObject({
      status: 504,
      code: 'WALKTHROUGH_TIMEOUT',
    })
    expect(fake.generateCalls).toHaveLength(2)
  })

  it('rejects with 502 when the model call fails', async () => {
    fake.setGenerateImpl(async () => {
      throw new Error('model unavailable')
    })

    await expect(service.generate(SESSION_ID, {})).rejects.toMatchObject({ status: 502 })
    expect(fake.generateCalls).toHaveLength(2)
  })

  it('retries an unparseable reply once', async () => {
    let calls = 0
    fake.setGenerateImpl(async () => {
      calls += 1
      return calls === 1 ? 'not json' : modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }])
    })

    const { walkthrough, created } = await service.generate(SESSION_ID, {})

    expect(created).toBe(true)
    expect(fake.generateCalls).toHaveLength(2)
    expect(walkthrough.stops).toHaveLength(1)
  })

  it('retries a failed call once', async () => {
    let calls = 0
    fake.setGenerateImpl(async () => {
      calls += 1
      if (calls === 1) {
        throw new Error('model unavailable')
      }
      return modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }])
    })

    const { walkthrough, created } = await service.generate(SESSION_ID, {})

    expect(created).toBe(true)
    expect(fake.generateCalls).toHaveLength(2)
    expect(walkthrough.stops).toHaveLength(1)
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

  it('plans then explains each stop', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? LARGE_PLAN_REPLY : EXPLANATION_REPLY),
    )

    const { walkthrough, created } = await service.generate(SESSION_ID, {})

    expect(created).toBe(true)
    expect(walkthrough.stops.map((stop) => stop.title)).toEqual(['A', 'B', 'C'])
    expect(walkthrough.stops.every((stop) => stop.status === 'ready')).toBe(true)
    expect(walkthrough.stops.every((stop) => stop.explanation === 'Why')).toBe(true)
    expect(fake.generateCalls).toHaveLength(4)
    expect(fake.generateCalls.filter((prompt) => prompt.includes(PLAN_MARKER))).toHaveLength(1)
  })

  it('exposes pending stops while explaining', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    const explainResolvers: Array<(text: string) => void> = []
    fake.setGenerateImpl((prompt) => {
      if (prompt.includes(PLAN_MARKER)) {
        return Promise.resolve(LARGE_PLAN_REPLY)
      }
      return new Promise<string>((resolve) => {
        explainResolvers.push(resolve)
      })
    })

    const pending = service.generate(SESSION_ID, {})

    await vi.waitFor(async () => {
      const state = await service.getState(SESSION_ID)
      expect(state.generating).toBe(true)
      expect(state.walkthrough?.stops).toHaveLength(3)
      expect(state.walkthrough?.stops.every((stop) => stop.status === 'pending')).toBe(true)
    })

    await vi.waitFor(() => expect(explainResolvers).toHaveLength(3))
    for (const resolve of explainResolvers) {
      resolve(EXPLANATION_REPLY)
    }

    const { walkthrough } = await pending
    expect(walkthrough.stops.every((stop) => stop.status === 'ready')).toBe(true)
  })

  it('marks a stop failed when its explanation fails twice', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) => {
      if (prompt.includes(PLAN_MARKER)) {
        return Promise.resolve(LARGE_PLAN_REPLY)
      }
      if (prompt.includes('## Stop: B')) {
        return Promise.resolve('not json')
      }
      return Promise.resolve(EXPLANATION_REPLY)
    })

    const { walkthrough, created } = await service.generate(SESSION_ID, {})

    expect(created).toBe(true)
    const byTitle = new Map(walkthrough.stops.map((stop) => [stop.title, stop]))
    expect(byTitle.get('B')?.status).toBe('failed')
    expect(byTitle.get('A')?.status).toBe('ready')
    expect(byTitle.get('C')?.status).toBe('ready')
    expect(fake.generateCalls.filter((prompt) => prompt.includes('## Stop: B'))).toHaveLength(2)
  })

  it('reuses explanations for unchanged stops after an edit', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    const first = await service.generate(SESSION_ID, {})
    expect(first.walkthrough.stops.every((stop) => stop.status === 'ready')).toBe(true)
    const callsAfterFirst = fake.generateCalls.length
    expect(callsAfterFirst).toBe(4)

    sessions[SESSION_ID]!.changes = EDITED_LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? EDITED_LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    const second = await service.generate(SESSION_ID, {})

    expect(second.created).toBe(true)
    const secondCalls = fake.generateCalls.slice(callsAfterFirst)
    expect(secondCalls).toHaveLength(2)
    expect(secondCalls.filter((prompt) => prompt.includes(PLAN_MARKER))).toHaveLength(1)
    expect(secondCalls.filter((prompt) => prompt.includes('## Stop: A'))).toHaveLength(1)
    expect(secondCalls.filter((prompt) => prompt.includes('## Stop: B'))).toHaveLength(0)
    expect(secondCalls.filter((prompt) => prompt.includes('## Stop: C'))).toHaveLength(0)

    const byTitle = new Map(second.walkthrough.stops.map((stop) => [stop.title, stop]))
    expect(byTitle.get('A')!.explanation).toBe('explained-A')
    expect(byTitle.get('B')!.explanation).toBe('explained-B')
    expect(byTitle.get('C')!.explanation).toBe('explained-C')
    expect(second.walkthrough.stops.every((stop) => stop.status === 'ready')).toBe(true)
  })

  it('retries only failed stops on an unchanged diff', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) => {
      if (prompt.includes(PLAN_MARKER)) {
        return Promise.resolve(LARGE_PLAN_REPLY)
      }
      if (prompt.includes('## Stop: B')) {
        return Promise.resolve('not json')
      }
      return Promise.resolve(explanationFor(prompt))
    })

    const first = await service.generate(SESSION_ID, {})
    const firstByTitle = new Map(first.walkthrough.stops.map((stop) => [stop.title, stop]))
    expect(firstByTitle.get('B')!.status).toBe('failed')
    const callsAfterFirst = fake.generateCalls.length

    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    const second = await service.generate(SESSION_ID, {})

    expect(second.created).toBe(true)
    const secondCalls = fake.generateCalls.slice(callsAfterFirst)
    expect(secondCalls).toHaveLength(1)
    expect(secondCalls[0]).toContain('## Stop: B')
    expect(secondCalls.filter((prompt) => prompt.includes(PLAN_MARKER))).toHaveLength(0)

    const secondByTitle = new Map(second.walkthrough.stops.map((stop) => [stop.title, stop]))
    expect(secondByTitle.get('B')!.status).toBe('ready')
    expect(secondByTitle.get('A')!.explanation).toBe('explained-A')
    expect(secondByTitle.get('C')!.explanation).toBe('explained-C')
  })

  it('regenerate ignores previous explanations', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    await service.generate(SESSION_ID, {})
    const callsAfterFirst = fake.generateCalls.length

    await service.generate(SESSION_ID, { regenerate: true })

    expect(fake.generateCalls.length - callsAfterFirst).toBe(4)
  })

  it('does not reuse explanations across models', async () => {
    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    } as SessionInfo
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    await service.generate(SESSION_ID, {})
    const callsAfterFirst = fake.generateCalls.length

    sessions[SESSION_ID]!.info = {
      id: SESSION_ID,
      title: 'Title',
      model: { providerID: 'openai', id: 'gpt-5' },
    } as SessionInfo
    sessions[SESSION_ID]!.changes = EDITED_LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? EDITED_LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    await service.generate(SESSION_ID, {})

    expect(fake.generateCalls.length - callsAfterFirst).toBe(4)
  })

  it('lists surviving previous stops in the plan prompt', async () => {
    sessions[SESSION_ID]!.changes = LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    await service.generate(SESSION_ID, {})
    const callsAfterFirst = fake.generateCalls.length

    sessions[SESSION_ID]!.changes = EDITED_LARGE_CHANGES
    fake.setGenerateImpl((prompt) =>
      Promise.resolve(prompt.includes(PLAN_MARKER) ? EDITED_LARGE_PLAN_REPLY : explanationFor(prompt)),
    )

    await service.generate(SESSION_ID, {})

    const planPrompt = fake.generateCalls.slice(callsAfterFirst).find((prompt) => prompt.includes(PLAN_MARKER))
    expect(planPrompt).toBeDefined()
    expect(planPrompt).toContain('Previous stops')
    expect(planPrompt).toContain('- B:')
    expect(planPrompt).toContain('- C:')
    expect(planPrompt).not.toContain('- A:')
  })

  it('keeps a single call for small diffs', async () => {
    fake.setGenerateImpl(async () =>
      modelReply([{ title: 'A', explanation: 'x', hunkIds: THREE_HUNK_IDS }]),
    )

    const { walkthrough } = await service.generate(SESSION_ID, {})

    expect(fake.generateCalls).toHaveLength(1)
    expect(walkthrough.stops).toHaveLength(1)
    expect(walkthrough.stops[0]!.status).toBe('ready')
  })

  it('does not cache a diff read that an execution event invalidated', async () => {
    const diffMock = vi.mocked(fake.client.api.session.diff)
    let resolveDiff: (changes: FileDiffInfo[]) => void = () => {}
    diffMock.mockImplementationOnce(
      () => new Promise<FileDiffInfo[]>((resolve) => {
        resolveDiff = resolve
      }),
    )

    const pending = service.getState(SESSION_ID)
    await vi.waitFor(() => expect(diffMock).toHaveBeenCalledTimes(1))
    service.handleEvent(sessionEvent('session.execution.succeeded', SESSION_ID))
    resolveDiff(threeHunks)
    await pending

    await service.getState(SESSION_ID)
    expect(diffMock).toHaveBeenCalledTimes(2)
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
