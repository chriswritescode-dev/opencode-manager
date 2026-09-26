import { beforeEach, describe, expect, it } from 'vitest'
import { busyStatusesFromActiveSessions, useSessionStatus } from './sessionStatusStore'

const resetStore = () => {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusDirectories: new Map(),
    statusRevisions: new Map(),
    revision: 0,
  })
}

describe('sessionStatusStore', () => {
  beforeEach(() => {
    resetStore()
  })

  it('carries over a busy session recorded for another directory', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')
    store.setStatus('session-b', { type: 'busy' }, '/repo-b')

    useSessionStatus.getState().replaceStatuses({}, '/repo-a')

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'busy' })
  })

  it('clears a busy session when its own directory snapshot omits it', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' }, '/repo-a')

    useSessionStatus.getState().replaceStatuses({}, '/repo-a')

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('fully replaces the map when no directory is supplied', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')
    store.setStatus('session-b', { type: 'busy' }, '/repo-b')

    useSessionStatus.getState().replaceStatuses({ 'session-a': { type: 'busy' } })

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-b')).toEqual({ type: 'idle' })
  })

  it('preserves an optimistic active session across a directory snapshot', () => {
    useSessionStatus.getState().setOptimisticActive('session-a', 10_000)

    useSessionStatus.getState().replaceStatuses({}, '/repo-b')

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })

    useSessionStatus.getState().clearStatus('session-a')
  })

  it('records a directory when an unchanged status hash arrives', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({ 'session-a': { type: 'busy' } }, '/repo-a')
    useSessionStatus.getState().replaceStatuses({}, '/repo-b')

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('prunes the recorded directory when clearStatus runs', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')
    store.clearStatus('session-a')
    store.setStatus('session-a', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({}, '/repo-b')

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('prunes the recorded directory when a snapshot drops the session', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')
    store.replaceStatuses({}, '/repo-a')
    store.setStatus('session-a', { type: 'busy' })

    useSessionStatus.getState().replaceStatuses({}, '/repo-b')

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('maps active session ids to busy statuses', () => {
    expect(busyStatusesFromActiveSessions({ 'session-a': { type: 'running' } })).toEqual({
      'session-a': { type: 'busy' },
    })
  })

  it('does not let a snapshot captured before an idle event resurrect the session', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')

    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('session-a', { type: 'idle' })

    useSessionStatus.getState().replaceStatuses(
      { 'session-a': { type: 'busy' } },
      undefined,
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('does not let an older empty snapshot erase a session that started after it was captured', () => {
    const store = useSessionStatus.getState()
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')

    useSessionStatus.getState().replaceStatuses({}, undefined, snapshotRevision)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('applies unrelated snapshot entries while preserving a newer live entry', () => {
    const store = useSessionStatus.getState()
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('session-live', { type: 'busy' }, '/repo-a')

    useSessionStatus.getState().replaceStatuses(
      { 'session-snapshot': { type: 'busy' } },
      undefined,
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('session-live')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-snapshot')).toEqual({ type: 'busy' })
  })

  it('clears an inactive session from a snapshot captured after its last event', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' }, '/repo-a')

    const snapshotRevision = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, undefined, snapshotRevision)

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('applies a snapshot captured after a live idle event', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'idle' })
    const snapshotRevision = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses(
      { 'session-a': { type: 'busy' } },
      undefined,
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
      undefined,
      snapshotRevision,
    )

    expect(useSessionStatus.getState().getStatus('unseen')).toEqual({ type: 'idle' })
  })

  it('does not let a deferred empty snapshot erase a repeated busy event', () => {
    const store = useSessionStatus.getState()
    store.setStatus('repeat', { type: 'busy' }, '/repo-a')
    const snapshotRevision = store.beginStatusSnapshot()
    store.setStatus('repeat', { type: 'busy' }, '/repo-a')

    useSessionStatus.getState().replaceStatuses({}, undefined, snapshotRevision)

    expect(useSessionStatus.getState().getStatus('repeat')).toEqual({ type: 'busy' })
  })

  it('rejects an older global snapshot once a newer global snapshot has been applied', () => {
    const store = useSessionStatus.getState()
    const older = store.beginStatusSnapshot()
    const newer = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses(
      { active: { type: 'busy' } },
      undefined,
      newer,
    )
    useSessionStatus.getState().replaceStatuses({}, undefined, older)

    expect(useSessionStatus.getState().getStatus('active')).toEqual({ type: 'busy' })
  })

  it('rejects an older global snapshot that would clear sessions added by a newer snapshot', () => {
    const store = useSessionStatus.getState()
    const older = store.beginStatusSnapshot()
    const newer = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses({}, undefined, newer)
    useSessionStatus.getState().replaceStatuses(
      { active: { type: 'busy' } },
      undefined,
      older,
    )

    expect(useSessionStatus.getState().getStatus('active')).toEqual({ type: 'idle' })
  })

  it('applies a newer snapshot after an older snapshot in completion order', () => {
    const store = useSessionStatus.getState()
    const older = store.beginStatusSnapshot()
    const newer = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses({}, undefined, older)
    useSessionStatus.getState().replaceStatuses(
      { active: { type: 'busy' } },
      undefined,
      newer,
    )

    expect(useSessionStatus.getState().getStatus('active')).toEqual({ type: 'busy' })
  })
})
