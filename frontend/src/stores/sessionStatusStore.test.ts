import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStatus, beginOptimisticBusy, rollbackOptimisticBusy } from './sessionStatusStore'

describe('optimistic busy helpers', () => {
  beforeEach(() => {
    useSessionStatus.getState().replaceStatuses({})
  })

  it('beginOptimisticBusy on idle session sets busy and returns idle', () => {
    const previous = beginOptimisticBusy('session-1')
    expect(previous).toEqual({ type: 'idle' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })
  })

  it('rollbackOptimisticBusy returns session to idle', () => {
    beginOptimisticBusy('session-1')
    rollbackOptimisticBusy('session-1', { type: 'idle' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
  })

  it('beginOptimisticBusy on already-busy session returns busy and keeps busy', () => {
    useSessionStatus.getState().setStatus('session-1', { type: 'busy' })
    const previous = beginOptimisticBusy('session-1')
    expect(previous).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })
    rollbackOptimisticBusy('session-1', { type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'busy' })
  })

  it('busy state is scoped per sessionID', () => {
    beginOptimisticBusy('a')
    expect(useSessionStatus.getState().getStatus('b')).toEqual({ type: 'idle' })
  })
})
