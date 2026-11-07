import type { FileDiffInfo } from '@opencode-manager/shared/opencode'
import type { ChangeHunk, WalkthroughOutputData } from '@opencode-manager/shared/schemas'
import { buildChangesInput } from './change-outline'
import { OutputError } from './output-error'

export interface OutputFinalizeResult {
  data: unknown
  uncoveredHunkIds: string[]
}

export type BuiltinOutputFinalizer = (data: unknown, changes: FileDiffInfo[]) => OutputFinalizeResult

interface WalkthroughStopDraft {
  id: string
  title: string
  explanation: string
  hunkIds: string[]
}

interface WalkthroughDraft {
  title: string
  summary: string
  stops: WalkthroughStopDraft[]
  risks?: string[]
  testing?: string
}

export function finalizeWalkthroughData(
  data: unknown,
  changes: FileDiffInfo[],
): { data: WalkthroughOutputData; uncoveredHunkIds: string[] } {
  const input = buildChangesInput(changes)
  const hunkById = new Map<string, ChangeHunk>()
  for (const hunk of [...input.hunks, ...input.mechanicalHunks]) {
    hunkById.set(hunk.id, hunk)
  }

  const draft = data as WalkthroughDraft
  const unknownIds: string[] = []
  const seenUnknown = new Set<string>()
  const stops = draft.stops.map((stop) => {
    const hunks: ChangeHunk[] = []
    for (const hunkId of stop.hunkIds) {
      const hunk = hunkById.get(hunkId)
      if (hunk) {
        hunks.push(hunk)
        continue
      }
      if (!seenUnknown.has(hunkId)) {
        seenUnknown.add(hunkId)
        unknownIds.push(hunkId)
      }
    }
    return { id: stop.id, title: stop.title, explanation: stop.explanation, hunks }
  })

  if (unknownIds.length > 0) {
    throw new OutputError(
      `Unknown hunk ids: ${unknownIds.join(', ')}; call read_output_input for valid ids`,
      400,
      { code: 'OUTPUT_UNKNOWN_HUNK' },
    )
  }

  const referenced = new Set(stops.flatMap((stop) => stop.hunks.map((hunk) => hunk.id)))
  const fileOrder = new Map(changes.map((change, index) => [change.file, index]))
  const otherHunks = [...input.hunks, ...input.mechanicalHunks]
    .map((hunk, index) => ({ hunk, index }))
    .filter((entry) => !referenced.has(entry.hunk.id))
    .sort((left, right) => {
      const fileDelta = (fileOrder.get(left.hunk.file) ?? 0) - (fileOrder.get(right.hunk.file) ?? 0)
      return fileDelta !== 0 ? fileDelta : left.index - right.index
    })
    .map((entry) => entry.hunk)

  return {
    data: {
      title: draft.title,
      summary: draft.summary,
      stops,
      otherHunks,
      ...(draft.risks !== undefined ? { risks: draft.risks } : {}),
      ...(draft.testing !== undefined ? { testing: draft.testing } : {}),
    },
    uncoveredHunkIds: otherHunks.map((hunk) => hunk.id),
  }
}

export const BUILTIN_FINALIZERS: Record<'walkthrough', BuiltinOutputFinalizer> = {
  walkthrough: finalizeWalkthroughData,
}
