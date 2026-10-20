import { beforeEach, describe, expect, it } from 'vitest'
import { busyStatusesFromActiveSessions, hasBackgroundActivity, useSessionStatus } from './sessionStatusStore'

const resetStore = () => {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    parents: new Map(),
    directories: new Map(),
    sessionServers: new Map(),
    runningShells: new Map(),
    shellRevisions: new Map(),
    shellRevision: 0,
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

  it('keeps a remote server session status across a local snapshot', () => {
    const store = useSessionStatus.getState()
    store.setSessionServer('session-remote', 'srv_remote')
    store.setStatus('session-remote', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().getStatus('session-remote')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().knownSessions.has('session-remote')).toBe(true)
  })

  it('does not record ownership for a local session server', () => {
    const store = useSessionStatus.getState()
    store.setSessionServer('session-local', 'local')

    expect(useSessionStatus.getState().sessionServers.has('session-local')).toBe(false)
  })

  it('removes a stale busy status owned by the reconciled server', () => {
    const store = useSessionStatus.getState()
    store.setSessionServer('session-remote', 'srv_remote')
    store.setStatus('session-remote', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceServerStatuses('srv_remote', {}, token)

    expect(useSessionStatus.getState().getStatus('session-remote')).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().knownSessions.has('session-remote')).toBe(false)
  })

  it('keeps statuses owned by another server or by the local server during a server snapshot', () => {
    const store = useSessionStatus.getState()
    store.setSessionServer('session-remote-a', 'srv_remote_a')
    store.setStatus('session-remote-a', { type: 'busy' })
    store.setSessionServer('session-remote-b', 'srv_remote_b')
    store.setStatus('session-remote-b', { type: 'busy' })
    store.setStatus('session-local', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceServerStatuses('srv_remote_a', {}, token)

    expect(useSessionStatus.getState().getStatus('session-remote-a')).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().getStatus('session-remote-b')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-local')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().knownSessions.has('session-remote-b')).toBe(true)
    expect(useSessionStatus.getState().knownSessions.has('session-local')).toBe(true)
  })

  it('does not let a server snapshot clobber a live status update made after it began', () => {
    const store = useSessionStatus.getState()
    store.setSessionServer('session-remote', 'srv_remote')
    store.setStatus('session-remote', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    store.setStatus('session-remote', { type: 'idle' })

    useSessionStatus.getState().replaceServerStatuses(
      'srv_remote',
      { 'session-remote': { type: 'busy' } },
      token,
    )

    expect(useSessionStatus.getState().getStatus('session-remote')).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().knownSessions.has('session-remote')).toBe(true)
  })

  it('records snapshot sessions as owned by the reconciled server', () => {
    const token = useSessionStatus.getState().beginStatusSnapshot()

    useSessionStatus.getState().replaceServerStatuses(
      'srv_remote',
      { 'session-remote': { type: 'busy' } },
      token,
    )

    expect(useSessionStatus.getState().getStatus('session-remote')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().sessionServers.get('session-remote')).toBe('srv_remote')
    expect(useSessionStatus.getState().knownSessions.has('session-remote')).toBe(true)
  })

  it('forgets the recorded server of a deleted session', () => {
    const store = useSessionStatus.getState()
    store.setSessionServer('session-remote', 'srv_remote')
    store.setStatus('session-remote', { type: 'busy' })

    store.forgetSession('session-remote')

    expect(useSessionStatus.getState().sessionServers.has('session-remote')).toBe(false)
    expect(useSessionStatus.getState().getStatus('session-remote')).toEqual({ type: 'idle' })
  })

  it('keeps a more specific live status when a snapshot reports the session as busy', () => {
    const store = useSessionStatus.getState()
    const retry = { type: 'retry' as const, attempt: 2, message: 'rate limited', next: 1234 }
    store.setStatus('session-retry', retry)
    store.setStatus('session-compact', { type: 'compact' })

    const token = useSessionStatus.getState().beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses(
      { 'session-retry': { type: 'busy' }, 'session-compact': { type: 'busy' } },
      token,
    )

    expect(useSessionStatus.getState().getStatus('session-retry')).toEqual(retry)
    expect(useSessionStatus.getState().getStatus('session-compact')).toEqual({ type: 'compact' })
  })

  it('maps active session ids to busy statuses', () => {
    expect(busyStatusesFromActiveSessions({ 'session-a': { type: 'running' } })).toEqual({
      'session-a': { type: 'busy' },
    })
  })

  it('records knowledge for an idle event on an untracked session without adding a status', () => {
    const before = useSessionStatus.getState()

    before.setStatus('untracked', { type: 'idle' })

    const after = useSessionStatus.getState()
    expect(after.statuses).toBe(before.statuses)
    expect(after.getStatus('untracked')).toEqual({ type: 'idle' })
    expect(after.knownSessions.has('untracked')).toBe(true)
  })

  it('keeps knowledge of a session after it goes idle', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })
    expect(useSessionStatus.getState().knownSessions.has('session-a')).toBe(true)

    store.setStatus('session-a', { type: 'idle' })

    expect(useSessionStatus.getState().knownSessions.has('session-a')).toBe(true)
    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('marks sessions from a global snapshot as known', () => {
    const store = useSessionStatus.getState()
    const token = store.beginStatusSnapshot()

    useSessionStatus.getState().replaceStatuses({ 'session-a': { type: 'busy' } }, token)

    expect(useSessionStatus.getState().knownSessions.has('session-a')).toBe(true)
    expect(useSessionStatus.getState().knownSessions.has('session-unknown')).toBe(false)
  })

  it('does not treat a session omitted from a later snapshot as finished', () => {
    const store = useSessionStatus.getState()
    store.setStatus('session-a', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().knownSessions.has('session-a')).toBe(false)
    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('records a child outcome and preserves it when the status goes idle', () => {
    const store = useSessionStatus.getState()
    store.setStatus('child-a', { type: 'busy' })
    store.setOutcome('child-a', 'failed')

    store.setStatus('child-a', { type: 'idle' })

    expect(useSessionStatus.getState().outcomes.get('child-a')).toBe('failed')
    expect(useSessionStatus.getState().knownSessions.has('child-a')).toBe(true)
  })

  it('clears a child outcome when a new execution starts', () => {
    const store = useSessionStatus.getState()
    store.setOutcome('child-a', 'interrupted')

    store.clearOutcome('child-a')

    expect(useSessionStatus.getState().outcomes.get('child-a')).toBeUndefined()
  })

  it('applies an authoritative idle session snapshot from the child session query', () => {
    const store = useSessionStatus.getState()
    const token = store.beginStatusSnapshot()

    store.applySessionSnapshot('child-a', {
      id: 'child-a',
      projectID: 'project-1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      outcome: 'failed',
      time: { created: 1, updated: 2, idle: 2 },
      location: { directory: '/repo' },
    }, token)

    expect(useSessionStatus.getState().knownSessions.has('child-a')).toBe(true)
    expect(useSessionStatus.getState().getStatus('child-a')).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().outcomes.get('child-a')).toBe('failed')
  })

  it('applies a running child session snapshot as busy', () => {
    const store = useSessionStatus.getState()
    const token = store.beginStatusSnapshot()

    store.applySessionSnapshot('child-a', {
      id: 'child-a',
      projectID: 'project-1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: '/repo' },
    }, token)

    expect(useSessionStatus.getState().knownSessions.has('child-a')).toBe(true)
    expect(useSessionStatus.getState().getStatus('child-a')).toEqual({ type: 'busy' })
  })

  it('does not overwrite a newer live terminal event with a stale session snapshot', () => {
    const store = useSessionStatus.getState()
    const token = store.beginStatusSnapshot()
    store.setStatus('child-a', { type: 'idle' })

    store.applySessionSnapshot('child-a', {
      id: 'child-a',
      projectID: 'project-1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: '/repo' },
    }, token)

    expect(useSessionStatus.getState().getStatus('child-a')).toEqual({ type: 'idle' })
  })

  it('clears a stale child outcome when a fresh authoritative busy snapshot arrives', () => {
    const store = useSessionStatus.getState()
    store.setOutcome('child-a', 'failed')
    const token = store.beginStatusSnapshot()

    store.applySessionSnapshot('child-a', {
      id: 'child-a',
      projectID: 'project-1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: '/repo' },
    }, token)

    expect(useSessionStatus.getState().outcomes.get('child-a')).toBeUndefined()
    expect(useSessionStatus.getState().getStatus('child-a')).toEqual({ type: 'busy' })
  })

  it('preserves confirmed idle knowledge across a global snapshot', () => {
    const store = useSessionStatus.getState()
    store.setStatus('child-idle', { type: 'idle' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().knownSessions.has('child-idle')).toBe(true)
    expect(useSessionStatus.getState().getStatus('child-idle')).toEqual({ type: 'idle' })
  })

  it('turns a formerly active session omitted from a global snapshot unknown', () => {
    const store = useSessionStatus.getState()
    store.setStatus('child-active', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().knownSessions.has('child-active')).toBe(false)
  })

  it('does not let a snapshot erase an idle event received in flight', () => {
    const store = useSessionStatus.getState()
    store.setStatus('child-active', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    store.setStatus('child-active', { type: 'idle' })

    useSessionStatus.getState().replaceStatuses({}, token)

    expect(useSessionStatus.getState().knownSessions.has('child-active')).toBe(true)
    expect(useSessionStatus.getState().getStatus('child-active')).toEqual({ type: 'idle' })
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

  it('forgets a session status, knowledge, and outcome', () => {
    const store = useSessionStatus.getState()
    store.setStatus('child-a', { type: 'busy' })
    store.setOutcome('child-a', 'failed')

    store.forgetSession('child-a')

    const after = useSessionStatus.getState()
    expect(after.statuses.has('child-a')).toBe(false)
    expect(after.statusCache.has('child-a')).toBe(false)
    expect(after.knownSessions.has('child-a')).toBe(false)
    expect(after.outcomes.has('child-a')).toBe(false)
  })

  it('does not let an in-flight snapshot resurrect a forgotten session', () => {
    const store = useSessionStatus.getState()
    store.setStatus('child-a', { type: 'busy' })

    const token = store.beginStatusSnapshot()
    store.forgetSession('child-a')

    useSessionStatus.getState().applySessionSnapshot('child-a', {
      id: 'child-a',
      projectID: 'project-1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: '/repo' },
    }, token)

    const after = useSessionStatus.getState()
    expect(after.statuses.has('child-a')).toBe(false)
    expect(after.knownSessions.has('child-a')).toBe(false)
    expect(after.outcomes.has('child-a')).toBe(false)
  })

  it('reports background activity when the session owns a running shell', () => {
    const store = useSessionStatus.getState()
    store.setShellRunning('shell-1', 'session-a', '/repo')

    expect(hasBackgroundActivity(useSessionStatus.getState(), 'session-a')).toBe(true)
  })

  it('reports background activity up the parent chain through a busy descendant', () => {
    const store = useSessionStatus.getState()
    store.setSessionParent('child', 'parent')
    store.setSessionParent('parent', 'grandparent')
    store.setStatus('child', { type: 'busy' })

    expect(hasBackgroundActivity(useSessionStatus.getState(), 'parent')).toBe(true)
    expect(hasBackgroundActivity(useSessionStatus.getState(), 'grandparent')).toBe(true)
  })

  it('reports no background activity when children are idle', () => {
    const store = useSessionStatus.getState()
    store.setSessionParent('child', 'parent')
    store.setStatus('child', { type: 'idle' })

    expect(hasBackgroundActivity(useSessionStatus.getState(), 'parent')).toBe(false)
  })

  it('does not hang on a parent cycle', () => {
    const store = useSessionStatus.getState()
    store.setSessionParent('a', 'b')
    store.setSessionParent('b', 'a')

    expect(hasBackgroundActivity(useSessionStatus.getState(), 'a')).toBe(false)
  })

  it('replaces running shells only for the given directory', () => {
    const store = useSessionStatus.getState()
    store.setShellRunning('shell-a', 'session-a', '/repo-a')
    store.setShellRunning('shell-b', 'session-b', '/repo-b')

    const token = store.beginShellSnapshot()
    store.replaceRunningShells('/repo-a', [{ id: 'shell-c', sessionID: 'session-c' }], token)

    const shells = useSessionStatus.getState().runningShells
    expect(shells.has('shell-a')).toBe(false)
    expect(shells.get('shell-c')).toEqual({ sessionID: 'session-c', directory: '/repo-a' })
    expect(shells.get('shell-b')).toEqual({ sessionID: 'session-b', directory: '/repo-b' })
  })

  it('does not let a shell snapshot resurrect a shell that exited while it was in flight', () => {
    const store = useSessionStatus.getState()
    store.setShellRunning('shell-1', 'session-a', '/repo')

    const token = store.beginShellSnapshot()
    store.clearShell('shell-1')

    useSessionStatus.getState().replaceRunningShells(
      '/repo',
      [{ id: 'shell-1', sessionID: 'session-a' }],
      token,
    )

    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('does not let a shell snapshot drop a shell created while it was in flight', () => {
    const store = useSessionStatus.getState()
    const token = store.beginShellSnapshot()
    store.setShellRunning('shell-2', 'session-b', '/repo')

    useSessionStatus.getState().replaceRunningShells('/repo', [], token)

    expect(useSessionStatus.getState().runningShells.get('shell-2')).toEqual({
      sessionID: 'session-b',
      directory: '/repo',
    })
  })

  it('records a shell exit for an unknown shell so a snapshot cannot resurrect it', () => {
    const store = useSessionStatus.getState()
    const token = store.beginShellSnapshot()
    store.clearShell('shell-ghost')

    useSessionStatus.getState().replaceRunningShells(
      '/repo',
      [{ id: 'shell-ghost', sessionID: 'session-a' }],
      token,
    )

    expect(useSessionStatus.getState().runningShells.has('shell-ghost')).toBe(false)
  })

  it('clears shell revisions once the last shell snapshot ends', () => {
    const store = useSessionStatus.getState()
    const token = store.beginShellSnapshot()
    store.setShellRunning('shell-1', 'session-a', '/repo')
    expect(useSessionStatus.getState().shellRevisions.size).toBe(1)

    store.replaceRunningShells('/repo', [{ id: 'shell-1', sessionID: 'session-a' }], token)

    expect(useSessionStatus.getState().shellRevisions.size).toBe(0)
  })

  it('forgets a session parent and its running shells', () => {
    const store = useSessionStatus.getState()
    store.setSessionParent('child-a', 'parent')
    store.setShellRunning('shell-1', 'child-a', '/repo')

    store.forgetSession('child-a')

    const after = useSessionStatus.getState()
    expect(after.parents.has('child-a')).toBe(false)
    expect(after.runningShells.has('shell-1')).toBe(false)
  })
})
