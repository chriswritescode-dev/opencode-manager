import { beforeEach, describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeForm, makeSession } from '@/test/fixtures/api'
import { connectTestEventStream } from '@/test/render'
import { renderSessionPage, sessionPageStatus } from '@/test/sessionPage'
import { installMatchMedia } from '@/test/browserFakes'
import type { FormInfo } from '@opencode-manager/shared/opencode'

const VIEWED_SESSION_ID = 'viewed-session'

const viewedSessionForm = makeForm({
  id: 'form-viewed',
  sessionID: VIEWED_SESSION_ID,
  title: 'Continue A',
})

const nextSessionForm = makeForm({
  id: 'form-next',
  sessionID: VIEWED_SESSION_ID,
  title: 'Continue B',
})

const otherSessionForm = makeForm({
  id: 'form-other',
  sessionID: 'other-session',
  title: 'Continue B',
})

function viewedSession(sessionId: string = VIEWED_SESSION_ID) {
  return makeSession({ id: sessionId, title: 'Viewed session', location: { directory: '/test/repo' } })
}

function formsRoute(forms: () => FormInfo[]) {
  return () => ({ json: { data: forms() } })
}

describe('SessionDetail form prompt session scoping', () => {
  beforeEach(() => {
    installMatchMedia(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
  })

  it('renders the viewed session form when another session owns the globally current form', async () => {
    renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => [viewedSessionForm, otherSessionForm]),
    })

    expect((await screen.findAllByText('Continue A'))[0]).toBeInTheDocument()
  })

  it('renders no form prompt when only another session has a pending form', async () => {
    renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => [otherSessionForm]),
    })

    await waitFor(() => expect(screen.getByTestId('prompt-overlay')).toBeInTheDocument())
    expect(screen.queryByText('Continue B')).not.toBeInTheDocument()
  })

  it('submits the viewed session form answer for that form', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => [viewedSessionForm, otherSessionForm]),
    })

    await user.click(await screen.findByRole('button', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(
        fetchFake.lastRequest('POST', `/api/opencode/api/session/${VIEWED_SESSION_ID}/form/form-viewed/reply`)?.body,
      ).toEqual({ answer: { q0: 'Yes' } })
    })
  })

  it('clears a minimized indicator once its form resolves elsewhere and opens the next form', async () => {
    const user = userEvent.setup()
    const pendingForms: FormInfo[] = [viewedSessionForm]
    const { eventStream } = renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => pendingForms),
    })

    await user.click(await screen.findByRole('button', { name: 'Continue A' }))
    expect(await screen.findByRole('button', { name: 'Dismiss form' })).toBeInTheDocument()
    pendingForms.length = 0
    await connectTestEventStream(eventStream)

    act(() => {
      eventStream?.message({
        id: 'evt_form_replied',
        created: 2,
        type: 'form.replied',
        data: { id: viewedSessionForm.id, sessionID: VIEWED_SESSION_ID },
        directory: '/test/repo',
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Dismiss form' })).not.toBeInTheDocument()
    })

    act(() => {
      eventStream?.message({
        id: 'evt_form_next',
        created: 3,
        type: 'form.created',
        data: { form: nextSessionForm },
        directory: '/test/repo',
      })
    })

    expect((await screen.findAllByText('Continue B'))[0]).toBeInTheDocument()
  })

  it('dismisses a minimized form through the API and then opens the next form', async () => {
    const user = userEvent.setup()
    const pendingForms: FormInfo[] = [viewedSessionForm]
    const { fetchFake, eventStream } = renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => pendingForms),
    })

    await user.click(await screen.findByRole('button', { name: 'Continue A' }))
    await user.click(await screen.findByRole('button', { name: 'Dismiss form' }))

    await waitFor(() => {
      expect(
        fetchFake.findRequests('DELETE', `/api/opencode/api/session/${VIEWED_SESSION_ID}/form/form-viewed`),
      ).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Dismiss form' })).not.toBeInTheDocument()
    })

    pendingForms.length = 0
    await connectTestEventStream(eventStream)
    act(() => {
      eventStream?.message({
        id: 'evt_form_next',
        created: 3,
        type: 'form.created',
        data: { form: nextSessionForm },
        directory: '/test/repo',
      })
    })

    expect((await screen.findAllByText('Continue B'))[0]).toBeInTheDocument()
  })

  it('retains a minimized form and reports an error when dismissal fails', async () => {
    const user = userEvent.setup()
    renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => [viewedSessionForm]),
      formCancelRespond: () => sessionPageStatus(500, { error: 'boom' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Continue A' }))
    await user.click(await screen.findByRole('button', { name: 'Dismiss form' }))

    expect(await screen.findByText('Failed to dismiss form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss form' })).toBeInTheDocument()
  })

  it('fills the prompt overlay from the header to the prompt while a form is open on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })
    installMatchMedia(true)

    renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => [viewedSessionForm]),
    })

    await screen.findAllByText('Continue A')
    expect(screen.getByTestId('prompt-overlay')).toHaveClass('top-0')
  })

  it('bounds the form card by the space above the prompt on desktop so its header stays visible', async () => {
    renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => [viewedSessionForm]),
    })

    await screen.findAllByText('Continue A')
    const overlay = screen.getByTestId('prompt-overlay')
    expect(overlay).toHaveClass('top-0', 'justify-end', 'pointer-events-none')
    expect(overlay.firstElementChild).toHaveClass('max-h-full', 'min-h-0', 'pointer-events-auto')
  })

  it('keeps the prompt overlay anchored without an open form or once the form is minimized', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })
    installMatchMedia(true)

    const { eventStream } = renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      session: viewedSession(),
      forms: formsRoute(() => []),
    })

    await waitFor(() => expect(screen.getByTestId('prompt-overlay')).toBeInTheDocument())
    expect(screen.getByTestId('prompt-overlay')).not.toHaveClass('top-0')

    await connectTestEventStream(eventStream)
    act(() => {
      eventStream?.message({
        id: 'evt_form_created',
        created: 2,
        type: 'form.created',
        data: { form: viewedSessionForm },
        directory: '/test/repo',
      })
    })

    await waitFor(() => expect(screen.getByTestId('prompt-overlay')).toHaveClass('top-0'))

    await userEvent.click(screen.getByRole('button', { name: 'Drag to minimize' }))

    await waitFor(() => expect(screen.getByTestId('prompt-overlay')).not.toHaveClass('top-0'))
  })

  it('does not show a pending form for a session that no longer exists', async () => {
    renderSessionPage({
      route: `/repos/1/sessions/${VIEWED_SESSION_ID}`,
      sessionRespond: () => sessionPageStatus(404, { name: 'SessionNotFoundError', message: 'Session not found' }),
      forms: formsRoute(() => [viewedSessionForm]),
    })

    expect(await screen.findByText('Session not found')).toBeInTheDocument()
    expect(screen.queryByText('Continue A')).not.toBeInTheDocument()
  })
})
