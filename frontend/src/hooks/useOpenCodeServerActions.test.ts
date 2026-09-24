import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { describeInterruptedSessions } from './useOpenCodeServerActions'

describe('describeInterruptedSessions', () => {
  it('returns nothing when no session was interrupted', () => {
    expect(describeInterruptedSessions(new QueryClient(), [])).toBeUndefined()
  })

  it('names interrupted sessions by cached title and falls back to the session ID', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['opencode', 'session', 'ses_a', '/repo'], { id: 'ses_a', title: 'Fix login bug' })

    expect(describeInterruptedSessions(queryClient, ['ses_a', 'ses_b'])).toBe(
      'Interrupted: Fix login bug, ses_b. OpenCode resumes them automatically.',
    )
  })
})
