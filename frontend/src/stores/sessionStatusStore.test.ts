import { beforeEach, describe, expect, it } from 'vitest'
import { busyStatusesFromActiveSessions, useSessionStatus } from './sessionStatusStore'

const resetStore = () => {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    revision: 0,
  })
}

describe('sessionStatusStore', () => {
  beforeEach(() => {
    resetStore()
  })

  it('fully replaces the map for a global snapshot', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })
    store.setStatus('session-b', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({ 'session-a': { type: 'busy' } }, token)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'idle' })
  })

  it('preserves an optimistic active session across a global snapshot', () => {
    useSessionStatus.getState().setOptimisticActive('session-a', 10_000)

    const token = useSessionStatus.getState().beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })

    useSessionStatus.getState().clearStatus('session-a')
  })

  it('maps active session ids to busy statuses', () => {
    expect(busyStatusesFromActiveSessions({ 'session-a': { type: 'running' } })).toEqual({
      'session-a': { type: 'busy' },
    })
  })

  it('leaves the store state untouched for an idle event on an untracked session with no snapshot in flight', () => {
    const before = useSessionStatus.getState()

    before.setStatus('untracked', { type: 'idle' })

    expect(useSessionStatus.getState()).toBe(before)
  })

  it('leaves the statuses map identity unchanged for a repeated identical busy status outside a snapshot', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })
    const statuses = useSessionStatus.getState().statuses

    store.setStatus('session-a', { type: 'busy' })

    expect(useSessionStatus.getState().statuses).toBe(statuses)
  })

  it('clears recorded revisions when the last snapshot ends via replaceStatuses', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })
    const token = store.beginStatusSnapshot()
    store.setStatus('session-b', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().statusRevisions.size).toBe(0)
  })

  it('clears recorded revisions when the last snapshot ends via endStatusSnapshot', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })
    const token = store.beginStatusSnapshot()
    store.setStatus('session-b', { type: 'busy' })

    useSessionStatus.getState().endStatusSnapshot(token)

    expect(useSessionStatus.getState().statusRevisions.size).toBe(0)
  })

  it('does not replace the statuses map for an unchanged snapshot', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })
    const statuses = useSessionStatus.getState().statuses
    const token = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses({ 'session-a': { type: 'busy' } }, token)

    expect(useSessionStatus.getState().statuses).toBe(statuses)
  })

  it('keeps an event received during an in-flight snapshot over the snapshot', () => {
    const store = useSessionStatus.getState()
    const token = store.beginStatusSnapshot()
    store.setStatus('session-a', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('does not let a snapshot captured before an idle event resurrect the session', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })

    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('session-a', { type: 'idle' })

    useSessionStatus.getState().replaceStatuses(
      { 'session-a': { type: 'busy' } },
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('does not let an older empty snapshot erase a session that started after it was captured', () => {
    const store = useSessionStatus.getState()
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('session-a', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({}, snapshotRevision)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('applies unrelated snapshot entries while preserving a newer live entry', () => {
    const store = useSessionStatus.getState()
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('session-live', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses(
      { 'session-snapshot': { type: 'busy' } },
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('session-live')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-snapshot')).toEqual({ type: 'busy' })
  })

  it('clears an inactive session from a snapshot captured after its last event', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })

    const snapshotRevision = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, snapshotRevision)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('applies a snapshot captured after a live idle event', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'idle' })
    const snapshotRevision = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses(
      { 'session-a': { type: 'busy' } },
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('does not let an initial snapshot resurrect an unknown session that received an idle event', () => {
    const store = useSessionStatus.getState()
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('unseen', { type: 'idle' })

    useSessionStatus.getState().replaceStatuses(
      { unseen: { type: 'busy' } },
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('unseen')).toEqual({ type: 'idle' })
  })

  it('does not let a deferred empty snapshot erase a repeated busy event', () => {
    const store = useSessionStatus.getState()
    store.setStatus('repeat', { type: 'busy' })
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('repeat', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({}, snapshotRevision)

    expect(useSessionStatus.getState().getStatus('repeat')).toEqual({ type: 'busy' })
  })

  it('rejects an older global snapshot once a newer global snapshot has been applied', () => {
    const store = useSessionStatus.getState()
    const older = store.beginStatusSnapshot()
    const newer = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses(
      { active: { type: 'busy' } },
      newer,
    )
    useSessionStatus.getState().replaceStatuses({}, older)

    expect(useSessionStatus.getState().getStatus('active')).toEqual({ type: 'busy' })
  })

  it('rejects an older global snapshot that would clear sessions added by a newer snapshot', () => {
    const store = useSessionStatus.getState()
    const older = store.beginStatusSnapshot()
    const newer = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses({}, newer)
    useSessionStatus.getState().replaceStatuses(
      { active: { type: 'busy' } },
      older,
    )

    expect(useSessionStatus.getState().getStatus('active')).toEqual({ type: 'idle' })
  })

  it('applies a newer snapshot after an older snapshot in completion order', () => {
    const store = useSessionStatus.getState()
    const older = store.beginStatusSnapshot()
    const newer = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses({}, older)
    useSessionStatus.getState().replaceStatuses(
      { active: { type: 'busy' } },
      newer,
    )

    expect(useSessionStatus.getState().getStatus('active')).toEqual({ type: 'busy' })
  })
})
