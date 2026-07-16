import { describe, it, expect, vi } from 'vitest'
import { collectSessionEvents, rewriteEventsForRemote, transferSession, planReplayBatches, moveReminderText, type HistoryEventRow, type ReplayEvent, type TransferDeps } from '../src/session-move.js'

describe('collectSessionEvents', () => {
  it('collects a session\'s events in seq order with remapped aggregateID', () => {
    const rows: HistoryEventRow[] = [
      { id: 'e3', aggregate_id: 'ses_a', seq: 2, type: 'append', data: { text: 'c' } },
      { id: 'e1', aggregate_id: 'ses_a', seq: 0, type: 'append', data: { text: 'a' } },
      { id: 'e2', aggregate_id: 'ses_a', seq: 1, type: 'append', data: { text: 'b' } },
      { id: 'e4', aggregate_id: 'ses_b', seq: 0, type: 'append', data: { text: 'x' } },
    ]

    const result = collectSessionEvents(rows, 'ses_a')

    expect(result).toEqual({
      kind: 'ok',
      events: [
        { id: 'e1', aggregateID: 'ses_a', seq: 0, type: 'append', data: { text: 'a' } },
        { id: 'e2', aggregateID: 'ses_a', seq: 1, type: 'append', data: { text: 'b' } },
        { id: 'e3', aggregateID: 'ses_a', seq: 2, type: 'append', data: { text: 'c' } },
      ],
    })
  })

  it('returns empty when the session has no events', () => {
    const rows: HistoryEventRow[] = [
      { id: 'e1', aggregate_id: 'other', seq: 0, type: 'append', data: {} },
    ]

    const result = collectSessionEvents(rows, 'unknown')

    expect(result).toEqual({ kind: 'empty' })
  })

  it('detects a gap in the sequence', () => {
    const rows: HistoryEventRow[] = [
      { id: 'e1', aggregate_id: 'ses_a', seq: 0, type: 'append', data: {} },
      { id: 'e2', aggregate_id: 'ses_a', seq: 1, type: 'append', data: {} },
      { id: 'e3', aggregate_id: 'ses_a', seq: 3, type: 'append', data: {} },
    ]

    const result = collectSessionEvents(rows, 'ses_a')

    expect(result).toEqual({ kind: 'gap', missingSeq: 2 })
  })

  it('detects a gap when sequence does not start at 0', () => {
    const rows: HistoryEventRow[] = [
      { id: 'e1', aggregate_id: 'ses_a', seq: 1, type: 'append', data: {} },
      { id: 'e2', aggregate_id: 'ses_a', seq: 2, type: 'append', data: {} },
    ]

    const result = collectSessionEvents(rows, 'ses_a')

    expect(result).toEqual({ kind: 'gap', missingSeq: 0 })
  })
})

describe('rewriteEventsForRemote', () => {
  const ctx = {
    localRoot: '/Users/x/repo',
    remoteRoot: '/workspace/repos/repo',
  }

  it('rewrites session.created info directory to the remote root', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.created.1',
        data: { info: { directory: '/Users/x/repo' } },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.info).toEqual({ directory: '/workspace/repos/repo' })
  })

  it('rewrites session.updated info directory to the remote root', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.updated.2',
        data: { info: { directory: '/Users/x/repo' } },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.info).toEqual({ directory: '/workspace/repos/repo' })
  })

  it('preserves subdirectories under the repo root', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.created.1',
        data: { info: { directory: '/Users/x/repo/packages/app' } },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.info).toEqual({ directory: '/workspace/repos/repo/packages/app' })
  })

  it('rewrites session.next.moved location directory', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.next.moved.1',
        data: { location: { directory: '/Users/x/repo/src' } },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.location).toEqual({ directory: '/workspace/repos/repo/src' })
  })

  it('strips workspaceID from info', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.created.1',
        data: { info: { directory: '/Users/x/repo', workspaceID: 'ws_abc' } },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.info).toEqual({ directory: '/workspace/repos/repo' })
    expect('workspaceID' in result[0]!.data.info).toBe(false)
  })

  it('strips workspaceID from location on moved events', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.next.moved.1',
        data: { location: { directory: '/Users/x/repo', workspaceID: 'ws_abc' } },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.location).toEqual({ directory: '/workspace/repos/repo' })
    expect('workspaceID' in result[0]!.data.location).toBe(false)
  })

  it('coerces ISO time string in data.timestamp to epoch millis (per 686c820d)', () => {
    const iso = '2026-07-01T10:00:00.000Z'
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.next.agent.switched.1',
        data: { timestamp: iso, agent: 'code' },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.timestamp).toBe(Date.parse(iso))
    expect(typeof result[0]!.data.timestamp).toBe('number')
  })

  it('leaves already-numeric timestamp untouched', () => {
    const epoch = 1778974142967
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.next.model.switched.1',
        data: { timestamp: epoch },
      },
    ]

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data.timestamp).toBe(epoch)
  })

  it('leaves unrelated events untouched without mutating input', () => {
    const events: ReplayEvent[] = [
      {
        id: 'e1', aggregateID: 'ses_a', seq: 0,
        type: 'session.next.step.ended.2',
        data: { sessionID: 'ses_a', step: { kind: 'code' } },
      },
    ]
    const frozen = JSON.parse(JSON.stringify(events))

    const result = rewriteEventsForRemote(events, ctx)

    expect(result[0]!.data).toEqual(frozen[0]!.data)
    expect(events).toEqual(frozen)
  })
})

describe('planReplayBatches', () => {
  it('splits events into batches of batchSize (default 10)', () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`, aggregateID: 'ses_a', seq: i, type: 'append', data: {},
    }))

    const batches = planReplayBatches(events)

    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(10)
    expect(batches[1]).toHaveLength(10)
    expect(batches[2]).toHaveLength(5)
    expect(batches[0]![0]!.seq).toBe(0)
    expect(batches[1]![0]!.seq).toBe(10)
    expect(batches[2]![0]!.seq).toBe(20)
  })

  it('returns a single batch when events fit within batchSize', () => {
    const events = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`, aggregateID: 'ses_a', seq: i, type: 'append', data: {},
    }))

    const batches = planReplayBatches(events, 10)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(3)
  })

  it('returns empty array for empty events', () => {
    expect(planReplayBatches([])).toEqual([])
  })
})

function makeHistoryEvents(sessionID: string, count: number, opts: { root?: string; types?: string[] } = {}): HistoryEventRow[] {
  const root = opts.root ?? '/Users/x/repo'
  const types = opts.types ?? ['session.created.1']
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    aggregate_id: sessionID,
    seq: i,
    type: types[Math.min(i, types.length - 1)]!,
    data: { info: { directory: root }, timestamp: '2026-07-01T10:00:00.000Z' },
  }))
}

describe('transferSession', () => {
  const input = { sessionID: 'ses_a', localRoot: '/Users/x/repo', remoteDirectory: '/workspace/repos/repo' }

  it('moves a session by replaying its full history in ordered batches', async () => {
    const history = makeHistoryEvents('ses_a', 25)
    const replayCalls: { dir: string; events: ReplayEvent[] }[] = []

    const deps: TransferDeps = {
      fetchLocalHistory: vi.fn().mockResolvedValue(history),
      replayEvents: vi.fn().mockImplementation(async (dir: string, events: ReplayEvent[]) => {
        replayCalls.push({ dir, events })
        return { sessionID: 'ses_a' }
      }),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'moved', sessionID: 'ses_a', replayedEvents: 25 })
    expect(replayCalls).toHaveLength(3)
    expect(replayCalls[0]!.dir).toBe('/workspace/repos/repo')
    expect(replayCalls[0]!.events).toHaveLength(10)
    expect(replayCalls[0]!.events[0]!.seq).toBe(0)
    expect(replayCalls[1]!.events).toHaveLength(10)
    expect(replayCalls[2]!.events).toHaveLength(5)

    expect(replayCalls[0]!.events[0]!.data.info.directory).toBe('/workspace/repos/repo')
  })

  it('reports replay progress after each batch', async () => {
    const history = makeHistoryEvents('ses_a', 25)
    const progress: [number, number][] = []

    const deps: TransferDeps = {
      fetchLocalHistory: vi.fn().mockResolvedValue(history),
      replayEvents: vi.fn().mockResolvedValue({ sessionID: 'ses_a' }),
      onProgress: (replayed, total) => progress.push([replayed, total]),
    }

    await transferSession(input, deps)

    expect(progress).toEqual([[0, 25], [10, 25], [20, 25], [25, 25]])
  })

  it('reports a missing session', async () => {
    const deps: TransferDeps = {
      fetchLocalHistory: vi.fn().mockResolvedValue([]),
      replayEvents: vi.fn(),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'not-found' })
    expect(deps.replayEvents).not.toHaveBeenCalled()
  })

  it('refuses to transfer corrupt history', async () => {
    const rows: HistoryEventRow[] = [
      { id: 'e0', aggregate_id: 'ses_a', seq: 0, type: 'session.created.1', data: {} },
      { id: 'e2', aggregate_id: 'ses_a', seq: 2, type: 'session.updated.2', data: {} },
    ]

    const deps: TransferDeps = {
      fetchLocalHistory: vi.fn().mockResolvedValue(rows),
      replayEvents: vi.fn(),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'corrupt-history', missingSeq: 1 })
    expect(deps.replayEvents).not.toHaveBeenCalled()
  })

  it('surfaces replay failure and stops', async () => {
    const history = makeHistoryEvents('ses_a', 25)
    let callCount = 0

    const deps: TransferDeps = {
      fetchLocalHistory: vi.fn().mockResolvedValue(history),
      replayEvents: vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 2) throw new Error('Replay diverged')
        return { sessionID: 'ses_a' }
      }),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'replay-failed', message: 'Replay diverged' })
    expect(callCount).toBe(2)
  })
})

describe('moveReminderText', () => {
  it('wraps the directory in a system-reminder block', () => {
    const result = moveReminderText('/workspace/repos/repo')
    expect(result).toContain('<system-reminder>')
    expect(result).toContain('</system-reminder>')
    expect(result).toContain('/workspace/repos/repo')
  })

  it('matches the native opencode wording byte-for-byte apart from the directory', () => {
    const dir = '/some/path'
    const result = moveReminderText(dir)
    const prefix = '<system-reminder>The user has changed the current working directory to "'
    expect(result.startsWith(prefix)).toBe(true)
    expect(result).toBe(
      `<system-reminder>The user has changed the current working directory to "${dir}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`,
    )
  })
})