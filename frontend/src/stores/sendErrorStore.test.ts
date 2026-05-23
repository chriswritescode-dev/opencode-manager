import { describe, it, expect, beforeEach } from 'vitest'
import { useSendErrorStore } from './sendErrorStore'

describe('useSendErrorStore', () => {
  beforeEach(() => {
    useSendErrorStore.setState({ errors: {} })
  })

  it('stores error keyed by sessionID', () => {
    const err = { sessionID: 'session-1', title: 'Error', message: 'Something failed' }
    useSendErrorStore.getState().setError(err)
    expect(useSendErrorStore.getState().getError('session-1')).toEqual(err)
  })

  it('clears error only for the specified sessionID', () => {
    useSendErrorStore.getState().setError({ sessionID: 'session-1', title: 'Error', message: 'msg1' })
    useSendErrorStore.getState().setError({ sessionID: 'session-2', title: 'Error', message: 'msg2' })
    useSendErrorStore.getState().clearError('session-1')
    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()
    expect(useSendErrorStore.getState().getError('session-2')).not.toBeNull()
  })

  it('returns null when no error exists for sessionID', () => {
    expect(useSendErrorStore.getState().getError('nonexistent')).toBeNull()
  })
})
