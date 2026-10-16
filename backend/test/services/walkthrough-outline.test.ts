import { describe, expect, it } from 'vitest'
import type { FileDiffInfo } from '@opencode-manager/shared/opencode'
import {
  MECHANICAL_TEXT_BUDGET,
  WALKTHROUGH_DIFF_MAX_CHARS,
  WALKTHROUGH_HUNK_MAX_CHARS,
  WALKTHROUGH_OUTLINE_LINE_MAX_CHARS,
  WALKTHROUGH_OUTLINE_PREVIEW_LINES,
  type WalkthroughHunk,
} from '@opencode-manager/shared/schemas'
import {
  buildWalkthroughInput,
  buildWalkthroughOutline,
  computeChangesHash,
  computeHunkId,
  formatHunkBlock,
  formatHunkOutline,
  formatWalkthroughFileChanges,
  formatWalkthroughOutline,
  isMechanicalChangePath,
} from '../../src/services/walkthrough-outline'

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

  it('keeps mechanical hunk text within the budget and summarizes every file with counts', () => {
    const oversizedPatch = Array.from({ length: 40 }, (_, index) => bigHunk(index)).join('\n')
    const { mechanicalHunks, omittedFiles } = buildWalkthroughInput([
      { file: 'pnpm-lock.yaml', patch: oversizedPatch, additions: 1200, deletions: 800, status: 'modified' },
      { file: 'src/__snapshots__/a.ts.snap', patch: hunkPatch(1), additions: 2, deletions: 3, status: 'modified' },
    ])

    expect(mechanicalHunks.map((hunk) => hunk.file)).toEqual([
      'pnpm-lock.yaml',
      'src/__snapshots__/a.ts.snap',
    ])
    expect(mechanicalHunks.reduce((total, hunk) => total + hunk.text.length, 0)).toBeLessThanOrEqual(
      MECHANICAL_TEXT_BUDGET,
    )
    expect(mechanicalHunks[0]).toMatchObject({ text: '', truncated: true, additions: 1200, deletions: 800 })
    expect(mechanicalHunks[1]).toMatchObject({ additions: 2, deletions: 3 })
    expect(mechanicalHunks[1]!.text).toContain('@@')
    expect(omittedFiles).toEqual([])
  })

  it('stores mechanical hunk text and counts while within the budget', () => {
    const { mechanicalHunks } = buildWalkthroughInput([
      {
        file: 'pnpm-lock.yaml',
        patch: `${hunkPatch(1)}\n${hunkPatch(2)}`,
        additions: 2,
        deletions: 2,
        status: 'modified',
      },
    ])

    expect(mechanicalHunks).toHaveLength(1)
    expect(mechanicalHunks[0]!.text).toContain('@@ -1,2 +1,2 @@')
    expect(mechanicalHunks[0]!.text).toContain('@@ -2,2 +2,2 @@')
    expect(mechanicalHunks[0]!.additions).toBe(2)
    expect(mechanicalHunks[0]!.deletions).toBe(2)
  })

  it('omits a binary mechanical file as binary', () => {
    const { mechanicalHunks, omittedFiles } = buildWalkthroughInput([
      change('pnpm-lock.yaml', 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\nBinary files differ'),
    ])

    expect(mechanicalHunks).toEqual([])
    expect(omittedFiles).toEqual([{ file: 'pnpm-lock.yaml', reason: 'binary' }])
  })

  it('labels a pure rename as renamed', () => {
    const { omittedFiles } = buildWalkthroughInput([
      change(
        'src/new.ts',
        'diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\nrename from src/old.ts\nrename to src/new.ts',
      ),
    ])

    expect(omittedFiles).toEqual([{ file: 'src/new.ts', reason: 'renamed' }])
  })

  it('labels a mode-only change as modeChange', () => {
    const { omittedFiles } = buildWalkthroughInput([
      change('script.sh', 'diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755'),
    ])

    expect(omittedFiles).toEqual([{ file: 'script.sh', reason: 'modeChange' }])
  })
})

describe('formatHunkOutline', () => {
  it('renders the id, file, status, header and change counts', () => {
    const hunk = hunkFixture('src/a.ts', '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;')
    const [first] = formatHunkOutline(hunk).split('\n')

    expect(first).toBe(`### ${hunk.id} src/a.ts (modified) @@ -1,2 +1,2 @@ +1 -1`)
  })

  it('previews changed lines and counts content lines that start with -- or ++', () => {
    const hunk = hunkFixture(
      'src/a.ts',
      '@@ -1,4 +1,4 @@\n--- a/x\n+++ b/x\n-const a = 1;\n+const a = 2;\n-const b = 1;\n+const b = 2;',
    )

    const single = formatHunkOutline(hunk, 1).split('\n')
    expect(single).toHaveLength(2)
    expect(single[1]).toBe('--- a/x')

    const full = formatHunkOutline(hunk).split('\n')
    expect(full).toContain('--- a/x')
    expect(full).toContain('+++ b/x')
    expect(full).toContain('-const a = 1;')
    expect(full).toContain('+const a = 2;')
    expect(full).toContain('-const b = 1;')
    expect(full).toContain('+const b = 2;')
    expect(full[0]).toContain('+3 -3')
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

describe('buildWalkthroughOutline', () => {
  it('packs every text hunk when the prefix is empty', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 300 }, (_, index) => change(`src/f${index}.ts`, hunkPatch(index))),
    )
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 0)

    expect(omittedFiles).toEqual([])
    expect(hunks).toHaveLength(300)
    for (const hunk of input.hunks) {
      expect(outline).toContain(hunk.id)
    }
  })

  it('omits trailing files as budget and never half-includes a file', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 400 }, (_, index) => change(`src/f${index}.ts`, longPatch(3, index * 3))),
    )
    const { omittedFiles, outline } = buildWalkthroughOutline(input, 0)

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
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 0)

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
    const { omittedFiles, outline } = buildWalkthroughOutline(input, 0)

    expect(input.mechanicalHunks).toHaveLength(1)
    expect(outline).not.toContain(input.mechanicalHunks[0]!.id)
    expect(outline).not.toContain('pnpm-lock.yaml')
    expect(omittedFiles).toEqual([])
  })

  it('admits less content behind a larger prefix', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 800 }, (_, index) => change(`src/f${index}.ts`, hunkPatch(index))),
    )

    const withoutPrefix = buildWalkthroughOutline(input, 0)
    const withPrefix = buildWalkthroughOutline(input, 20_000)

    expect(withPrefix.hunks.length).toBeLessThan(withoutPrefix.hunks.length)
    expect(withPrefix.omittedFiles.some((file) => file.reason === 'budget')).toBe(true)
    expect(buildWalkthroughOutline(input, 0).outline.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('bounds the included hunks and omits the remaining files as budget', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 200 }, (_, index) => change(`src/f${index}.ts`, longPatch(6, index * 6))),
    )
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 0)

    expect(hunks.length).toBeLessThan(input.hunks.length)
    expect(omittedFiles.filter((file) => file.reason === 'budget').length).toBeGreaterThan(0)
    expect(omittedFiles.every((file) => file.reason === 'budget')).toBe(true)
    expect(outline.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('never half-includes a file', () => {
    const input = buildWalkthroughInput([
      change('src/small.ts', hunkPatch(1)),
      change('src/huge.ts', longPatch(2000)),
    ])
    const { outline } = buildWalkthroughOutline(input, 0)

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
    const { hunks, omittedFiles, outline } = buildWalkthroughOutline(input, 0)

    expect(hunks.length).toBeGreaterThan(0)
    expect(omittedFiles).toEqual([{ file: longPath, reason: 'budget' }])
    expect(outline.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS)
  })

  it('retries at a shallower preview depth so every file fits', () => {
    const input = buildWalkthroughInput(
      Array.from({ length: 70 }, (_, index) => change(`src/f${index}.ts`, longPatch(1, index))),
    )
    const { hunks, omittedFiles } = buildWalkthroughOutline(input, 0)

    expect(omittedFiles).toEqual([])
    expect(hunks).toHaveLength(70)
  })
})

describe('formatWalkthroughOutline', () => {
  it('renders the header, the mechanical listing and the outline', () => {
    const changes = [change('src/a.ts', hunkPatch(1)), change('pnpm-lock.yaml', hunkPatch(2))]
    const text = formatWalkthroughOutline({
      title: 'My session',
      sourceDescription: 'the changes in this session',
      changes,
    })

    expect(text).toContain('# My session')
    expect(text).toContain('the changes in this session')
    expect(text).toContain('2 files, 1 text hunks.')
    expect(text).toContain("Call walkthrough_changes with { file } for a file's full hunks.")
    expect(text).toContain('## Mechanical files')
    expect(text).toContain('- pnpm-lock.yaml (modified, +1/-1)')
    expect(text).toContain('## Outline')
    expect(text).toContain(computeHunkId('src/a.ts', 'modified', hunkPatch(1)))
    expect(text).not.toContain(hunkPatch(2))
  })

  it('lists omitted files with their reasons', () => {
    const changes = [
      change('assets/logo.png', 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ'),
      change(
        'src/new.ts',
        'diff --git a/src/old.ts b/src/new.ts\nsimilarity index 100%\nrename from src/old.ts\nrename to src/new.ts',
      ),
    ]
    const text = formatWalkthroughOutline({
      title: 'My session',
      sourceDescription: 'the changes in this session',
      changes,
    })

    expect(text).toContain('## Omitted files')
    expect(text).toContain('- assets/logo.png (binary)')
    expect(text).toContain('- src/new.ts (renamed)')
  })

  it('never exceeds the budget plus the truncation marker', () => {
    const changes = Array.from(
      { length: 4000 },
      (_, index) => change(`src/f${index}.ts`, longPatch(3, index * 3)),
    )
    const text = formatWalkthroughOutline({
      title: 'My session',
      sourceDescription: 'the changes in this session',
      changes,
    })

    expect(text.length).toBeLessThanOrEqual(WALKTHROUGH_DIFF_MAX_CHARS + '\n[output truncated]'.length)
  })
})

describe('formatWalkthroughFileChanges', () => {
  it('returns the full hunks for a known file', () => {
    const changes = [
      change('src/a.ts', `${hunkPatch(1)}\n${hunkPatch(10)}`),
      change('src/b.ts', hunkPatch(20)),
    ]
    const text = formatWalkthroughFileChanges(changes, 'src/a.ts')!

    expect(text).toContain(hunkPatch(1))
    expect(text).toContain(hunkPatch(10))
    expect(text).not.toContain(hunkPatch(20))
    expect(text).toContain('```diff')
    expect(text).toContain(formatHunkBlock(hunkFixture('src/a.ts', hunkPatch(1))))
  })

  it('returns null for an unknown file', () => {
    const changes = [change('src/a.ts', hunkPatch(1))]

    expect(formatWalkthroughFileChanges(changes, 'src/nope.ts')).toBeNull()
  })

  it('returns the text of a mechanical file within the budget', () => {
    const changes = [change('pnpm-lock.yaml', hunkPatch(1))]
    const text = formatWalkthroughFileChanges(changes, 'pnpm-lock.yaml')!

    expect(text).toContain(hunkPatch(1))
    expect(text).toContain('```diff')
  })

  it('returns a counts-only line for an oversized mechanical file', () => {
    const oversized = Array.from({ length: 40 }, (_, index) => bigHunk(index)).join('\n')
    const changes = [
      { file: 'pnpm-lock.yaml', patch: oversized, additions: 1200, deletions: 800, status: 'modified' },
    ] as FileDiffInfo[]
    const text = formatWalkthroughFileChanges(changes, 'pnpm-lock.yaml')!

    expect(text).toBe('pnpm-lock.yaml (modified, +1200/-800)')
    expect(text).not.toContain('@@')
  })

  it('truncates to the budget plus the truncation marker', () => {
    const changes = [change('src/a.ts', longPatch(2000))]
    const text = formatWalkthroughFileChanges(changes, 'src/a.ts')!

    expect(text.length).toBe(WALKTHROUGH_DIFF_MAX_CHARS + '\n[output truncated]'.length)
    expect(text.endsWith('\n[output truncated]')).toBe(true)
  })
})
