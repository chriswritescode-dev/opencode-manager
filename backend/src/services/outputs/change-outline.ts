import { createHash } from 'node:crypto'
import {
  MECHANICAL_TEXT_BUDGET,
  CHANGES_TEXT_MAX_CHARS,
  CHANGE_HUNK_MAX_CHARS,
  CHANGES_OUTLINE_LINE_MAX_CHARS,
  CHANGES_OUTLINE_PREVIEW_LINES,
  type ChangeHunk,
  type OmittedChangeFile,
} from '@opencode-manager/shared/schemas'
import type { FileDiffInfo } from '@opencode-manager/shared/opencode'
import { countDiffLineChanges, parseDiffLines, splitDiffHunks, type DiffHunk } from '@opencode-manager/shared/utils'
import { truncateText } from '../../utils/text-truncate'

const HUNK_TRUNCATION_MARKER = '\n[hunk truncated]'
const OUTPUT_TRUNCATION_MARKER = '\n[output truncated]'
const TEXT_TRUNCATION_MARKER = ''
const OUTLINE_RETRY_DEPTHS = [3, 1, 0]

const MECHANICAL_LOCKFILE_NAMES = new Set([
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
])

const MECHANICAL_SUFFIXES = ['.snap', '.min.js', '.min.css', '.map']

export interface ChangesInput {
  hunks: ChangeHunk[]
  mechanicalHunks: ChangeHunk[]
  omittedFiles: OmittedChangeFile[]
}

export interface ChangesOutline {
  hunks: ChangeHunk[]
  omittedFiles: OmittedChangeFile[]
  outline: string
}

export interface FormatChangesOutlineOptions {
  title: string
  sourceDescription: string
  changes: FileDiffInfo[]
}

export function isMechanicalChangePath(file: string): boolean {
  const segments = file.split('/')
  const basename = segments.at(-1) ?? file
  if (MECHANICAL_LOCKFILE_NAMES.has(basename)) {
    return true
  }
  if (MECHANICAL_SUFFIXES.some((suffix) => file.endsWith(suffix))) {
    return true
  }
  return segments.includes('__snapshots__')
}

export function computeChangesHash(changes: FileDiffInfo[]): string {
  const hash = createHash('sha256')
  for (const change of changes) {
    hash.update(`${change.file}\0${change.status}\0${change.patch}\n`)
  }
  return hash.digest('hex')
}

export function computeHunkId(file: string, status: FileDiffInfo['status'], hunkText: string): string {
  const body = hunkText.split('\n').slice(1).join('\n')
  const digest = createHash('sha256').update(`${file}\0${status}\0${body}`).digest('hex')
  return `h_${digest.slice(0, 12)}`
}

export function buildChangesInput(changes: FileDiffInfo[]): ChangesInput {
  const hunks: ChangeHunk[] = []
  const mechanicalHunks: ChangeHunk[] = []
  const omittedFiles: OmittedChangeFile[] = []
  const hunkIdCounts = new Map<string, number>()
  let mechanicalTextLength = 0

  const nextHunkId = (file: string, status: FileDiffInfo['status'], text: string): string => {
    const baseId = computeHunkId(file, status, text)
    const count = (hunkIdCounts.get(baseId) ?? 0) + 1
    hunkIdCounts.set(baseId, count)
    return count === 1 ? baseId : `${baseId}_${count}`
  }

  const prepareHunks = (change: FileDiffInfo, fileHunks: DiffHunk[]): ChangeHunk[] =>
    fileHunks.map((hunk) => {
      const truncated = truncateText(hunk.text, CHANGE_HUNK_MAX_CHARS, HUNK_TRUNCATION_MARKER)
      return {
        id: nextHunkId(change.file, change.status, hunk.text),
        file: change.file,
        status: change.status,
        header: hunk.header,
        text: truncated.text,
        truncated: truncated.truncated,
      } satisfies ChangeHunk
    })

  const buildMechanicalHunk = (change: FileDiffInfo, fileHunks: DiffHunk[]): ChangeHunk => {
    const text = fileHunks.map((hunk) => hunk.text).join('\n')
    return {
      id: nextHunkId(change.file, change.status, text),
      file: change.file,
      status: change.status,
      header: fileHunks[0]!.header,
      text,
      truncated: false,
      additions: change.additions,
      deletions: change.deletions,
    } satisfies ChangeHunk
  }

  const buildMechanicalSummaryHunk = (change: FileDiffInfo): ChangeHunk => ({
    id: nextHunkId(change.file, change.status, ''),
    file: change.file,
    status: change.status,
    header: '',
    text: '',
    truncated: true,
    additions: change.additions,
    deletions: change.deletions,
  })

  changes.forEach((change) => {
    const mechanical = isMechanicalChangePath(change.file)
    const fileHunks = splitDiffHunks(change.patch)
    if (fileHunks.length === 0) {
      omittedFiles.push({ file: change.file, reason: classifyOmittedFileReason(change.patch) })
      return
    }

    if (mechanical) {
      const text = fileHunks.map((hunk) => hunk.text).join('\n')
      if (mechanicalTextLength + text.length <= MECHANICAL_TEXT_BUDGET) {
        mechanicalHunks.push(buildMechanicalHunk(change, fileHunks))
        mechanicalTextLength += text.length
      } else {
        mechanicalHunks.push(buildMechanicalSummaryHunk(change))
      }
      return
    }

    hunks.push(...prepareHunks(change, fileHunks))
  })

  return { hunks, mechanicalHunks, omittedFiles }
}

export function formatHunkOutline(
  hunk: ChangeHunk,
  previewLines = CHANGES_OUTLINE_PREVIEW_LINES,
): string {
  const { added, removed } = countDiffLineChanges(hunk.text)
  const head = `### ${hunk.id} ${hunk.file} (${hunk.status}) ${hunk.header} +${added} -${removed}`
  const preview = parseDiffLines(hunk.text)
    .filter((line) => line.type === 'add' || line.type === 'remove')
    .slice(0, previewLines)
    .map((line) =>
      truncateText(
        `${line.type === 'add' ? '+' : '-'}${line.content}`,
        CHANGES_OUTLINE_LINE_MAX_CHARS,
        TEXT_TRUNCATION_MARKER,
      ).text,
    )
  return [head, ...preview].join('\n')
}

export function formatHunkBlock(hunk: ChangeHunk): string {
  return `### ${hunk.id} ${hunk.file} (${hunk.status})\n\n\`\`\`diff\n${hunk.text}\n\`\`\``
}

function classifyOmittedFileReason(patch: string): OmittedChangeFile['reason'] {
  const binary = patch.includes('Binary files') || patch.includes('GIT binary patch')
  if (!binary && patch.includes('rename to ')) {
    return 'renamed'
  }
  if (!binary && (patch.includes('old mode ') || patch.includes('new mode '))) {
    return 'modeChange'
  }
  return 'binary'
}

function groupHunksByFile(hunks: ChangeHunk[]): ChangeHunk[][] {
  const groups: ChangeHunk[][] = []
  for (const hunk of hunks) {
    const last = groups.at(-1)
    if (last && last[0]!.file === hunk.file) {
      last.push(hunk)
    } else {
      groups.push([hunk])
    }
  }
  return groups
}

export function buildChangesOutline(input: ChangesInput, prefixLength: number): ChangesOutline {
  const groups = groupHunksByFile(input.hunks)

  const pack = (previewLines: number) => {
    let outline = ''
    const hunks: ChangeHunk[] = []
    const omittedFiles: OmittedChangeFile[] = []
    let exhausted = false
    for (const fileHunks of groups) {
      if (exhausted) {
        omittedFiles.push({ file: fileHunks[0]!.file, reason: 'budget' })
        continue
      }
      const block = fileHunks.map((hunk) => formatHunkOutline(hunk, previewLines)).join('\n')
      const next = outline.length === 0 ? block : `${outline}\n\n${block}`
      if (prefixLength + next.length > CHANGES_TEXT_MAX_CHARS) {
        exhausted = true
        omittedFiles.push({ file: fileHunks[0]!.file, reason: 'budget' })
        continue
      }
      outline = next
      hunks.push(...fileHunks)
    }
    return { hunks, omittedFiles, outline }
  }

  let packed = pack(CHANGES_OUTLINE_PREVIEW_LINES)
  if (packed.omittedFiles.length > 0) {
    for (const previewLines of OUTLINE_RETRY_DEPTHS) {
      const candidate = pack(previewLines)
      packed = candidate
      if (candidate.omittedFiles.length === 0) {
        break
      }
    }
  }

  return {
    hunks: packed.hunks,
    omittedFiles: [...input.omittedFiles, ...packed.omittedFiles],
    outline: packed.outline,
  }
}

function formatMechanicalFiles(hunks: ChangeHunk[]): string {
  if (hunks.length === 0) {
    return ''
  }
  return [
    '## Mechanical files',
    ...hunks.map((hunk) => `- ${hunk.file} (${hunk.status}, +${hunk.additions ?? 0}/-${hunk.deletions ?? 0})`),
  ].join('\n')
}

function formatOmittedFiles(files: OmittedChangeFile[]): string {
  if (files.length === 0) {
    return ''
  }
  return ['## Omitted files', ...files.map((file) => `- ${file.file} (${file.reason})`)].join('\n')
}

export function formatChangesOutline({ title, sourceDescription, changes }: FormatChangesOutlineOptions): string {
  const input = buildChangesInput(changes)
  const header = [
    `# ${title}`,
    sourceDescription,
    `${changes.length} files, ${input.hunks.length} text hunks. Call read_output_input with { file } for a file's full hunks.`,
  ].join('\n\n')
  const mechanical = formatMechanicalFiles(input.mechanicalHunks)
  const prefixLength =
    [header, mechanical, formatOmittedFiles(input.omittedFiles)].filter((section) => section.length > 0).join('\n\n')
      .length + '\n\n## Outline\n'.length
  const outline = buildChangesOutline(input, prefixLength)

  const sections = [header]
  if (mechanical.length > 0) {
    sections.push(mechanical)
  }
  const omitted = formatOmittedFiles(outline.omittedFiles)
  if (omitted.length > 0) {
    sections.push(omitted)
  }
  sections.push(`## Outline\n${outline.outline}`)

  return truncateText(sections.join('\n\n'), CHANGES_TEXT_MAX_CHARS, OUTPUT_TRUNCATION_MARKER).text
}

export function formatChangedFile(changes: FileDiffInfo[], file: string): string | null {
  const change = changes.find((candidate) => candidate.file === file)
  if (!change) {
    return null
  }
  const input = buildChangesInput([change])
  const blocks = [...input.hunks, ...input.mechanicalHunks].map((hunk) =>
    hunk.text.length === 0
      ? `${hunk.file} (${hunk.status}, +${hunk.additions ?? 0}/-${hunk.deletions ?? 0})`
      : formatHunkBlock(hunk),
  )
  const text = blocks.length > 0 ? blocks.join('\n\n') : `${change.file} (${change.status}) has no textual changes`
  return truncateText(text, CHANGES_TEXT_MAX_CHARS, OUTPUT_TRUNCATION_MARKER).text
}
