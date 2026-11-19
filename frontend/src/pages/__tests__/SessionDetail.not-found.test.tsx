import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeSession, makeUserMessage } from '@/test/fixtures/api'
import { renderSessionPage, sessionPageStatus } from '@/test/sessionPage'

describe('SessionDetail not-found handling', () => {
  it('shows the session not-found state for a malformed session id', async () => {
    const { capturedPathname } = renderSessionPage({
      route: '/repos/1/sessions/nope',
      sessionRespond: () => sessionPageStatus(400, { name: 'InvalidRequestError', message: 'Expected a string starting with "ses"' }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Back to sessions' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1'))
    expect(screen.queryByTestId('prompt-overlay')).not.toBeInTheDocument()
  })

  it('shows the session not-found state for a missing session', async () => {
    renderSessionPage({
      route: '/repos/1/sessions/nope',
      sessionRespond: () => sessionPageStatus(404, { name: 'SessionNotFoundError', message: 'Session not found' }),
    })

    expect(await screen.findByText('Session not found')).toBeInTheDocument()
  })

  it('renders the transcript for a loaded session', async () => {
    renderSessionPage({
      session: makeSession({ id: 'nope', title: 'Loaded', location: { directory: '/test/repo' } }),
      messages: [makeUserMessage({ id: 'msg_1', text: 'Hello from the transcript' })],
    })

    expect(await screen.findByText('Hello from the transcript')).toBeInTheDocument()
    expect(screen.getByLabelText('Session details: Loaded')).toBeInTheDocument()
  })
})
