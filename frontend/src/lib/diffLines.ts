export type DiffRowKind = 'add' | 'remove' | 'context' | 'gap'

export interface DiffRow {
  kind: DiffRowKind
  oldLine?: number
  newLine?: number
  text: string
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Parses a unified diff patch into numbered rows, emitting a gap row between hunks. */
export function parseUnifiedDiff(patch: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git')) {
      inHunk = false
      continue
    }

    if (line.startsWith('index ') || line.startsWith('\\ No newline')) continue

    const hunk = HUNK_HEADER.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      if (inHunk && rows.length > 0) rows.push({ kind: 'gap', text: '' })
      inHunk = true
      continue
    }

    if (!inHunk) continue

    if (line.startsWith('+')) {
      rows.push({ kind: 'add', newLine, text: line.slice(1) })
      newLine += 1
      continue
    }

    if (line.startsWith('-')) {
      rows.push({ kind: 'remove', oldLine, text: line.slice(1) })
      oldLine += 1
      continue
    }

    if (line.startsWith(' ')) {
      rows.push({ kind: 'context', oldLine, newLine, text: line.slice(1) })
      oldLine += 1
      newLine += 1
    }
  }

  return rows
}
