import { describe, it, expect, beforeEach } from 'vitest'
import { useSendErrorStore } from './sendErrorStore'

describe('useSendErrorStore', () => {
  beforeEach(() => {
    useSendErrorStore.setState({ errors: {}, queuedPrompts: {} })
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

  it('moves queued prompt text into failed error and clears the queued draft', () => {
    useSendErrorStore.getState().setQueuedPrompt('session-1', 'queued message')

    useSendErrorStore.getState().failQueuedPrompt({
      sessionID: 'session-1',
      title: 'Error',
      message: 'Failed',
    })

    expect(useSendErrorStore.getState().getError('session-1')).toEqual({
      sessionID: 'session-1',
      title: 'Error',
      message: 'Failed',
      failedPrompt: 'queued message',
    })
    expect(useSendErrorStore.getState().queuedPrompts['session-1']).toBeUndefined()
  })

  it('does not store an error when no queued prompt was tracked', () => {
    useSendErrorStore.getState().failQueuedPrompt({
      sessionID: 'session-1',
      title: 'Error',
      message: 'Failed',
    })

    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()
  })
})
