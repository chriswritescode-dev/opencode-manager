import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diffLines'

describe('parseUnifiedDiff', () => {
  it('numbers context, added, and removed lines from the hunk header', () => {
    const rows = parseUnifiedDiff(
      ['@@ -10,4 +20,5 @@', ' unchanged', '-removed', '+added', ' trailing'].join('\n'),
    )

    expect(rows).toEqual([
      { kind: 'context', oldLine: 10, newLine: 20, text: 'unchanged' },
      { kind: 'remove', oldLine: 11, text: 'removed' },
      { kind: 'add', newLine: 21, text: 'added' },
      { kind: 'context', oldLine: 12, newLine: 22, text: 'trailing' },
    ])
  })

  it('emits a gap row between hunks and continues numbering from each header', () => {
    const rows = parseUnifiedDiff(
      ['@@ -1,2 +1,2 @@', ' first', '+second', '@@ -40,1 +40,1 @@', '-old', '+new'].join('\n'),
    )

    expect(rows.map((row) => row.kind)).toEqual(['context', 'add', 'gap', 'remove', 'add'])
    expect(rows[1]).toMatchObject({ newLine: 2 })
    expect(rows[3]).toMatchObject({ oldLine: 40 })
    expect(rows[4]).toMatchObject({ newLine: 40 })
  })

  it('skips diff headers, index lines, and no-newline markers', () => {
    const rows = parseUnifiedDiff(
      [
        'diff --git a/file.ts b/file.ts',
        'index 1234567..89abcde 100644',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
        '\\ No newline at end of file',
      ].join('\n'),
    )

    expect(rows).toEqual([
      { kind: 'remove', oldLine: 1, text: 'before' },
      { kind: 'add', newLine: 1, text: 'after' },
    ])
  })
})
