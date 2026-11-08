import { z } from "zod";
import { gitRefSchema } from './git'

export const CHANGES_TEXT_MAX_CHARS = 60000;
export const CHANGE_HUNK_MAX_CHARS = 8000;
export const MECHANICAL_TEXT_BUDGET = 20000;
export const CHANGES_OUTLINE_PREVIEW_LINES = 6;
export const CHANGES_OUTLINE_LINE_MAX_CHARS = 160;

export const ChangeSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }),
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('staged') }),
  z.object({ kind: z.literal('unstaged') }),
  z.object({ kind: z.literal('branch'), base: gitRefSchema.optional() }),
  z.object({ kind: z.literal('pullRequest'), number: z.number().int().positive(), base: gitRefSchema.optional() }),
])

export type ChangeSource = z.infer<typeof ChangeSourceSchema>

export const DEFAULT_CHANGE_SOURCE: ChangeSource = { kind: 'session' }

export function changeSourceKey(source: ChangeSource): string {
  switch (source.kind) {
    case 'session':
    case 'uncommitted':
    case 'staged':
    case 'unstaged':
      return source.kind
    case 'branch':
      return `branch:${source.base ?? ''}`
    case 'pullRequest':
      return `pr:${source.number}:${source.base ?? ''}`
  }
}

export function describeChangeSource(source: ChangeSource): string {
  switch (source.kind) {
    case 'session':
      return 'the changes in this session'
    case 'uncommitted':
      return 'uncommitted changes'
    case 'staged':
      return 'staged changes'
    case 'unstaged':
      return 'unstaged changes'
    case 'branch':
      return source.base ? `branch against ${source.base}` : 'branch against the default branch'
    case 'pullRequest':
      return `pull request #${source.number}`
  }
}

export function toChangeSource(candidate: {
  kind: ChangeSource['kind']
  base?: string
  number?: number
}): ChangeSource | null {
  const base = candidate.base?.trim()
  switch (candidate.kind) {
    case 'session':
    case 'uncommitted':
    case 'staged':
    case 'unstaged':
      return { kind: candidate.kind }
    case 'branch':
      return parseChangeSourceCandidate(base ? { kind: 'branch', base } : { kind: 'branch' })
    case 'pullRequest':
      return parseChangeSourceCandidate(
        base
          ? { kind: 'pullRequest', number: candidate.number, base }
          : { kind: 'pullRequest', number: candidate.number },
      )
  }
}

function parseChangeSourceCandidate(candidate: unknown): ChangeSource | null {
  const parsed = ChangeSourceSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export const ChangeHunkSchema = z.object({
  id: z.string(),
  file: z.string(),
  status: z.enum(["added", "deleted", "modified"]),
  header: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

export type ChangeHunk = z.infer<typeof ChangeHunkSchema>;

export const OmittedChangeFileSchema = z.object({
  file: z.string(),
  reason: z.enum(["binary", "budget", "renamed", "modeChange"]),
});

export type OmittedChangeFile = z.infer<typeof OmittedChangeFileSchema>;
