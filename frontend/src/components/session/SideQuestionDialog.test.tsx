import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SIDE_QUESTION_INSTRUCTIONS } from '@/api/opencode'
import { installMatchMedia } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult, RecordedFetchRequest } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { SideQuestionDialog } from './SideQuestionDialog'

interface GenerationServer {
  route: FetchRoute
  requests: RecordedFetchRequest[]
  signals: Array<AbortSignal | null | undefined>
  resolve: (index: number, result: FetchRouteResult) => void
}

function createGenerationServer(plan: Array<FetchRouteResult | 'pending'>): GenerationServer {
  const requests: RecordedFetchRequest[] = []
  const signals: Array<AbortSignal | null | undefined> = []
  const resolvers: Array<(result: FetchRouteResult) => void> = []

  const route: FetchRoute = {
    method: 'POST',
    path: '/api/opencode/api/session/ses_1/generate',
    respond: (request, _params, init) => {
      const index = requests.length
      requests.push(request)
      signals.push(init?.signal)
      const outcome = plan[index] ?? { status: 500, json: { error: 'unexpected request' } }
      if (outcome !== 'pending') return outcome
      return new Promise<FetchRouteResult>((resolve) => {
        resolvers[index] = resolve
      })
    },
  }

  return {
    route,
    requests,
    signals,
    resolve: (index, result) => resolvers[index]?.(result),
  }
}

function renderDialog(
  server: GenerationServer,
  props: Partial<React.ComponentProps<typeof SideQuestionDialog>> = {},
) {
  return renderWithProviders(
    <SideQuestionDialog open onOpenChange={vi.fn()} sessionID="ses_1" {...props} />,
    {
      auth: false,
      theme: false,
      tts: false,
      toaster: false,
      fetchRoutes: [server.route],
    },
  )
}

function expectedPrompt(question: string): string {
  return `${SIDE_QUESTION_INSTRUCTIONS}\n\n${question}`
}

function FocusHost() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <textarea aria-label="prompt" />
      <button type="button" onClick={() => setOpen(true)}>open</button>
      {open && (
        <SideQuestionDialog
          open
          sessionID="ses_1"
          onOpenChange={(next) => {
            if (!next) setOpen(false)
          }}
        />
      )}
    </>
  )
}

describe('SideQuestionDialog', () => {
  it('focuses its input on open and returns focus to the previous element on Escape', async () => {
    installMatchMedia(true)
    render(<FocusHost />)
    const prompt = screen.getByLabelText('prompt')
    prompt.focus()

    fireEvent.click(screen.getByText('open'))

    const input = await screen.findByPlaceholderText('Ask a side question')
    await waitFor(() => expect(input).toHaveFocus())

    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(prompt).toHaveFocus())
  })

  it('asks a non-empty initial question once on mount and renders the answer', async () => {
    const server = createGenerationServer([{ json: { data: { text: '**42**' } } }])

    renderDialog(server, { initialQuestion: 'what is the answer?' })

    await waitFor(() => expect(server.requests).toHaveLength(1))
    expect(server.requests[0].body).toEqual({ prompt: expectedPrompt('what is the answer?') })
    expect(await screen.findByText('42')).toBeInTheDocument()
  })

  it('asks nothing until the user types and submits when the initial question is empty', async () => {
    const server = createGenerationServer([{ json: { data: { text: 'because' } } }])

    renderDialog(server)

    expect(server.requests).toHaveLength(0)

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: 'why?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(server.requests).toHaveLength(1))
    expect(server.requests[0].body).toEqual({ prompt: expectedPrompt('why?') })
    expect(await screen.findByText('because')).toBeInTheDocument()
  })

  it('shows Retry on failure and asks the same question again when clicked', async () => {
    const server = createGenerationServer([
      { status: 500, json: { error: 'nope' } },
      { json: { data: { text: 'retried answer' } } },
    ])

    renderDialog(server, { initialQuestion: 'why?' })

    await screen.findByText('Failed to get an answer')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(server.requests).toHaveLength(2))
    expect(server.requests[1].body).toEqual({ prompt: expectedPrompt('why?') })
    expect(await screen.findByText('retried answer')).toBeInTheDocument()
  })

  it.each([
    ['another value', 'question B'],
    ['cleared', ''],
  ] as const)('retries the failed question even when the draft was %s', async (_label, draft) => {
    const server = createGenerationServer([
      { status: 500, json: { error: 'nope' } },
      { json: { data: { text: 'retried answer' } } },
    ])

    renderDialog(server, { initialQuestion: 'question A' })

    await screen.findByText('Failed to get an answer')

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: draft },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(server.requests).toHaveLength(2))
    expect(server.requests[1].body).toEqual({ prompt: expectedPrompt('question A') })
  })

  it('cancels the pending request when a replacement question is submitted', async () => {
    const server = createGenerationServer(['pending', 'pending'])
    renderDialog(server, { initialQuestion: 'question A' })

    await waitFor(() => expect(server.requests).toHaveLength(1))

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: 'question B' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(server.requests).toHaveLength(2))
    expect(server.requests[1].body).toEqual({ prompt: expectedPrompt('question B') })
    expect(server.signals[0]?.aborted).toBe(true)
    expect(server.signals[1]?.aborted).toBe(false)

    server.resolve(1, { json: { data: { text: 'answer B' } } })
    expect(await screen.findByText('answer B')).toBeInTheDocument()

    server.resolve(0, { json: { data: { text: 'answer A' } } })
    await waitFor(() => expect(screen.queryByText('answer A')).not.toBeInTheDocument())
    expect(screen.getByText('answer B')).toBeInTheDocument()
  })

  it('aborts the in-flight request when unmounted', async () => {
    const server = createGenerationServer(['pending'])
    const { unmount } = renderDialog(server, { initialQuestion: 'why?' })

    await waitFor(() => expect(server.signals).toHaveLength(1))
    expect(server.signals[0]?.aborted).toBe(false)

    unmount()

    expect(server.signals[0]?.aborted).toBe(true)
  })
})
