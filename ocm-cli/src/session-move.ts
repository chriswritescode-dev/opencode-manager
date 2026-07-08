export type HistoryEventRow = { id: string; aggregate_id: string; seq: number; type: string; data: Record<string, unknown> }
export type ReplayEvent = { id: string; aggregateID: string; seq: number; type: string; data: Record<string, unknown> }
export type CollectResult =
  | { kind: 'ok'; events: ReplayEvent[] }
  | { kind: 'empty' }
  | { kind: 'gap'; missingSeq: number }
export type RewriteContext = { localRoot: string; remoteRoot: string }

export function collectSessionEvents(rows: HistoryEventRow[], sessionID: string): CollectResult {
  const filtered = rows.filter((r) => r.aggregate_id === sessionID)
  if (filtered.length === 0) return { kind: 'empty' }

  const sorted = [...filtered].sort((a, b) => a.seq - b.seq)

  if (sorted[0]!.seq !== 0) return { kind: 'gap', missingSeq: 0 }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.seq !== sorted[i - 1]!.seq + 1) {
      return { kind: 'gap', missingSeq: sorted[i - 1]!.seq + 1 }
    }
  }

  const events: ReplayEvent[] = sorted.map((r) => ({
    id: r.id,
    aggregateID: r.aggregate_id,
    seq: r.seq,
    type: r.type,
    data: r.data,
  }))

  return { kind: 'ok', events }
}

/**
 * Rewrites collected replay events for replay on a remote Manager server.
 *
 * Coercion rule for `data.timestamp` matches the prior implementation in
 * commit 686c820d (`coerceReplayBodyTimestamps`): ISO 8601 string timestamps
 * are converted to epoch milliseconds via `Date.parse`; already-numeric values
 * are left untouched.
 */
export function rewriteEventsForRemote(events: ReplayEvent[], ctx: RewriteContext): ReplayEvent[] {
  return events.map((event) => {
    const data = deepClone(event.data)

    if (shouldRewriteDirectory(event.type)) {
      rewriteDirectory(data, 'info', ctx)
      stripWorkspaceID(data, 'info')
    }

    if (isMovedEvent(event.type)) {
      rewriteDirectory(data, 'location', ctx)
      stripWorkspaceID(data, 'location')
    }

    coerceTimestamp(data)

    return { ...event, data }
  })
}

function shouldRewriteDirectory(type: string): boolean {
  return type.startsWith('session.created') || type.startsWith('session.updated')
}

function isMovedEvent(type: string): boolean {
  return type.startsWith('session.next.moved')
}

function rewriteDirectory(
  data: Record<string, unknown>,
  key: 'info' | 'location',
  ctx: RewriteContext,
): void {
  const container = data[key]
  if (!container || typeof container !== 'object') return
  const obj = container as Record<string, unknown>
  const dir = obj.directory
  if (typeof dir !== 'string') return
  if (dir === ctx.localRoot) {
    obj.directory = ctx.remoteRoot
  } else if (dir.startsWith(ctx.localRoot + '/')) {
    obj.directory = ctx.remoteRoot + dir.slice(ctx.localRoot.length)
  }
}

function stripWorkspaceID(data: Record<string, unknown>, key: 'info' | 'location'): void {
  const container = data[key]
  if (!container || typeof container !== 'object') return
  const obj = container as Record<string, unknown>
  delete obj.workspaceID
}

/** Per commit 686c820d: coerce `data.timestamp` from ISO string to epoch ms. */
function coerceTimestamp(data: Record<string, unknown>): void {
  const ts = data.timestamp
  if (typeof ts !== 'string') return
  const epoch = Date.parse(ts)
  if (!Number.isFinite(epoch)) return
  data.timestamp = epoch
}

export type TransferDeps = {
  fetchLocalHistory: () => Promise<HistoryEventRow[]>
  replayEvents: (remoteDirectory: string, events: ReplayEvent[]) => Promise<{ sessionID: string }>
}

export type TransferInput = { sessionID: string; localRoot: string; remoteDirectory: string }

export type TransferResult =
  | { kind: 'moved'; sessionID: string; replayedEvents: number }
  | { kind: 'not-found' }
  | { kind: 'corrupt-history'; missingSeq: number }
  | { kind: 'replay-failed'; message: string }

export function planReplayBatches(events: ReplayEvent[], batchSize = 10): ReplayEvent[][] {
  const batches: ReplayEvent[][] = []
  for (let i = 0; i < events.length; i += batchSize) {
    batches.push(events.slice(i, i + batchSize))
  }
  return batches
}

export async function transferSession(input: TransferInput, deps: TransferDeps): Promise<TransferResult> {
  const rows = await deps.fetchLocalHistory()
  const collect = collectSessionEvents(rows, input.sessionID)

  if (collect.kind === 'empty') return { kind: 'not-found' }
  if (collect.kind === 'gap') return { kind: 'corrupt-history', missingSeq: collect.missingSeq }

  const rewritten = rewriteEventsForRemote(collect.events, {
    localRoot: input.localRoot,
    remoteRoot: input.remoteDirectory,
  })

  const batches = planReplayBatches(rewritten)
  let replayed = 0

  for (const batch of batches) {
    try {
      await deps.replayEvents(input.remoteDirectory, batch)
      replayed += batch.length
    } catch (err) {
      return { kind: 'replay-failed', message: err instanceof Error ? err.message : String(err) }
    }
  }

  return { kind: 'moved', sessionID: input.sessionID, replayedEvents: replayed }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}