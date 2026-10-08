import { z } from "zod";

export const WALKTHROUGH_DIFF_MAX_CHARS = 60000;
export const WALKTHROUGH_HUNK_MAX_CHARS = 8000;
export const WALKTHROUGH_MAX_STOPS = 20;
export const WALKTHROUGH_TEXT_MAX_CHARS = 2000;
export const WALKTHROUGH_OUTLINE_PREVIEW_LINES = 6;
export const WALKTHROUGH_OUTLINE_LINE_MAX_CHARS = 160;

export const WalkthroughHunkSchema = z.object({
  id: z.string(),
  file: z.string(),
  status: z.enum(["added", "deleted", "modified"]),
  header: z.string(),
  text: z.string(),
  truncated: z.boolean(),
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

export type WalkthroughStopStatus = WalkthroughStop["status"];

export const WalkthroughOmittedFileSchema = z.object({
  file: z.string(),
  reason: z.enum(["binary", "budget"]),
});

export type WalkthroughOmittedFile = z.infer<typeof WalkthroughOmittedFileSchema>;

export const ChangeWalkthroughSchema = z.object({
  sessionId: z.string(),
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

export const GenerateChangeWalkthroughRequestSchema = z.object({
  regenerate: z.boolean().optional(),
});

export type GenerateChangeWalkthroughRequest = z.infer<typeof GenerateChangeWalkthroughRequestSchema>;

export const GitRefSchema = z.string().trim().min(1).max(200).regex(/^[^-\s][^\s]*$/)

export const WalkthroughSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }),
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('staged') }),
  z.object({ kind: z.literal('unstaged') }),
  z.object({ kind: z.literal('branch'), base: GitRefSchema.optional() }),
  z.object({ kind: z.literal('pullRequest'), number: z.number().int().positive(), base: GitRefSchema.optional() }),
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

export function parseWalkthroughSourceKey(key: string): WalkthroughSource | null {
  if (key === 'session' || key === 'uncommitted' || key === 'staged' || key === 'unstaged') {
    return { kind: key }
  }
  if (key.startsWith('branch:')) {
    const base = key.slice('branch:'.length)
    return parseWalkthroughSourceCandidate(base ? { kind: 'branch', base } : { kind: 'branch' })
  }
  if (key.startsWith('pr:')) {
    const rest = key.slice('pr:'.length)
    const separator = rest.indexOf(':')
    if (separator < 0) {
      return null
    }
    const number = Number(rest.slice(0, separator))
    const base = rest.slice(separator + 1)
    return parseWalkthroughSourceCandidate(
      base ? { kind: 'pullRequest', number, base } : { kind: 'pullRequest', number },
    )
  }
  return null
}

function parseWalkthroughSourceCandidate(candidate: unknown): WalkthroughSource | null {
  const parsed = WalkthroughSourceSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
