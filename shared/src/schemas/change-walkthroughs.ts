import { z } from "zod";
import { gitRefSchema } from './git'

export const WALKTHROUGH_DIFF_MAX_CHARS = 60000;
export const WALKTHROUGH_HUNK_MAX_CHARS = 8000;
export const MECHANICAL_TEXT_BUDGET = 20000;
export const WALKTHROUGH_MAX_STOPS = 20;
export const WALKTHROUGH_TEXT_MAX_CHARS = 2000;
export const WALKTHROUGH_OUTLINE_PREVIEW_LINES = 6;
export const WALKTHROUGH_OUTLINE_LINE_MAX_CHARS = 160;

export const WalkthroughSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }),
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('staged') }),
  z.object({ kind: z.literal('unstaged') }),
  z.object({ kind: z.literal('branch'), base: gitRefSchema.optional() }),
  z.object({ kind: z.literal('pullRequest'), number: z.number().int().positive(), base: gitRefSchema.optional() }),
])

export type WalkthroughSource = z.infer<typeof WalkthroughSourceSchema>

export const DEFAULT_WALKTHROUGH_SOURCE: WalkthroughSource = { kind: 'session' }

export function walkthroughSourceKey(source: WalkthroughSource): string {
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

export function describeWalkthroughSource(source: WalkthroughSource): string {
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

export function toWalkthroughSource(candidate: {
  kind: WalkthroughSource['kind']
  base?: string
  number?: number
}): WalkthroughSource | null {
  const base = candidate.base?.trim()
  switch (candidate.kind) {
    case 'session':
    case 'uncommitted':
    case 'staged':
    case 'unstaged':
      return { kind: candidate.kind }
    case 'branch':
      return parseWalkthroughSourceCandidate(base ? { kind: 'branch', base } : { kind: 'branch' })
    case 'pullRequest':
      return parseWalkthroughSourceCandidate(
        base
          ? { kind: 'pullRequest', number: candidate.number, base }
          : { kind: 'pullRequest', number: candidate.number },
      )
  }
}

export function parseWalkthroughSourceKey(key: string): WalkthroughSource | null {
  if (key === 'session' || key === 'uncommitted' || key === 'staged' || key === 'unstaged') {
    return { kind: key }
  }
  if (key.startsWith('branch:')) {
    return toWalkthroughSource({ kind: 'branch', base: key.slice('branch:'.length) })
  }
  if (key.startsWith('pr:')) {
    const rest = key.slice('pr:'.length)
    const separator = rest.indexOf(':')
    if (separator < 0) {
      return null
    }
    return toWalkthroughSource({
      kind: 'pullRequest',
      number: Number(rest.slice(0, separator)),
      base: rest.slice(separator + 1),
    })
  }
  return null
}

function parseWalkthroughSourceCandidate(candidate: unknown): WalkthroughSource | null {
  const parsed = WalkthroughSourceSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export const WalkthroughHunkSchema = z.object({
  id: z.string(),
  file: z.string(),
  status: z.enum(["added", "deleted", "modified"]),
  header: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

export type WalkthroughHunk = z.infer<typeof WalkthroughHunkSchema>;

export const WalkthroughStopSchema = z.object({
  id: z.string(),
  title: z.string(),
  explanation: z.string(),
  hunkIds: z.array(z.string()),
  status: z.enum(["pending", "ready", "failed"]),
  explanationKey: z.string().nullable(),
});

export type WalkthroughStop = z.infer<typeof WalkthroughStopSchema>;

export const WalkthroughOmittedFileSchema = z.object({
  file: z.string(),
  reason: z.enum(["binary", "budget", "renamed", "modeChange"]),
});

export type WalkthroughOmittedFile = z.infer<typeof WalkthroughOmittedFileSchema>;

export const ChangeWalkthroughSchema = z.object({
  sessionId: z.string(),
  source: WalkthroughSourceSchema,
  diffHash: z.string(),
  model: z.string().nullable(),
  summary: z.string(),
  stops: z.array(WalkthroughStopSchema),
  hunks: z.array(WalkthroughHunkSchema),
  omittedFiles: z.array(WalkthroughOmittedFileSchema),
  createdAt: z.number(),
});

export type ChangeWalkthrough = z.infer<typeof ChangeWalkthroughSchema>;

export const WalkthroughGenerationErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export type WalkthroughGenerationError = z.infer<typeof WalkthroughGenerationErrorSchema>;

export const ChangeWalkthroughStateSchema = z.object({
  walkthrough: ChangeWalkthroughSchema.nullable(),
  currentDiffHash: z.string().nullable(),
  stale: z.boolean(),
  generating: z.boolean(),
  error: WalkthroughGenerationErrorSchema.nullable(),
});

export type ChangeWalkthroughState = z.infer<typeof ChangeWalkthroughStateSchema>;

export const ChangeWalkthroughWireSchema = ChangeWalkthroughSchema.extend({
  hunks: z.array(WalkthroughHunkSchema).optional(),
});

export type ChangeWalkthroughWire = z.infer<typeof ChangeWalkthroughWireSchema>;

export const ChangeWalkthroughStateWireSchema = ChangeWalkthroughStateSchema.extend({
  walkthrough: ChangeWalkthroughWireSchema.nullable(),
});

export type ChangeWalkthroughStateWire = z.infer<typeof ChangeWalkthroughStateWireSchema>;

export function walkthroughHunksIdentity(
  walkthrough: Pick<ChangeWalkthrough, 'diffHash' | 'createdAt'>,
): string {
  return `${walkthrough.diffHash}:${walkthrough.createdAt}`
}

export const GenerateChangeWalkthroughRequestSchema = z.object({
  regenerate: z.boolean().optional(),
  source: WalkthroughSourceSchema.optional(),
  model: z.string().trim().min(1).max(512).optional(),
});

export type GenerateChangeWalkthroughRequest = z.infer<typeof GenerateChangeWalkthroughRequestSchema>;
