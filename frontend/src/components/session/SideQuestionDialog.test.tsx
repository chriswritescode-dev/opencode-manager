import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { stubMatchMedia } from '@/test/test-utils'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { SideQuestionDialog } from './SideQuestionDialog'

const mocks = vi.hoisted(() => ({
  askSideQuestion: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/opencode')>()),
  askSideQuestion: mocks.askSideQuestion,
}))

const renderDialog = (props: Partial<React.ComponentProps<typeof SideQuestionDialog>> = {}) =>
  render(
    <SideQuestionDialog
      open
      onOpenChange={vi.fn()}
      sessionID="ses_1"
      initialQuestion=""
      {...props}
    />,
  )

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('focuses its input on open and returns focus to the previous element on Escape', async () => {
    stubMatchMedia(true)
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
    mocks.askSideQuestion.mockResolvedValue('**42**')

    renderDialog({ initialQuestion: 'what is the answer?' })

    await waitFor(() => expect(mocks.askSideQuestion).toHaveBeenCalledTimes(1))
    expect(mocks.askSideQuestion).toHaveBeenCalledWith(
      'ses_1',
      'what is the answer?',
      expect.any(AbortSignal),
      'local',
    )
    expect(await screen.findByText('42')).toBeInTheDocument()
  })

  it('asks nothing until the user types and submits when the initial question is empty', async () => {
    mocks.askSideQuestion.mockResolvedValue('because')

    renderDialog()

    expect(mocks.askSideQuestion).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: 'why?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() =>
      expect(mocks.askSideQuestion).toHaveBeenCalledWith('ses_1', 'why?', expect.any(AbortSignal), 'local'),
    )
    expect(await screen.findByText('because')).toBeInTheDocument()
  })

  it('shows Retry on failure and asks again when clicked', async () => {
    mocks.askSideQuestion.mockRejectedValueOnce(new Error('nope'))

    renderDialog({ initialQuestion: 'why?' })

    await screen.findByText('Failed to get an answer')

    mocks.askSideQuestion.mockResolvedValueOnce('retried answer')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.askSideQuestion).toHaveBeenCalledTimes(2))
    expect(mocks.askSideQuestion).toHaveBeenLastCalledWith('ses_1', 'why?', expect.any(AbortSignal), 'local')
    expect(await screen.findByText('retried answer')).toBeInTheDocument()
  })

  it('retries the failed question even when the draft was edited to another value', async () => {
    mocks.askSideQuestion.mockRejectedValueOnce(new Error('nope'))

    renderDialog({ initialQuestion: 'question A' })

    await screen.findByText('Failed to get an answer')

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: 'question B' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.askSideQuestion).toHaveBeenCalledTimes(2))
    expect(mocks.askSideQuestion).toHaveBeenLastCalledWith(
      'ses_1',
      'question A',
      expect.any(AbortSignal),
      'local',
    )
  })

  it('retries the failed question even when the draft was cleared', async () => {
    mocks.askSideQuestion.mockRejectedValueOnce(new Error('nope'))

    renderDialog({ initialQuestion: 'question A' })

    await screen.findByText('Failed to get an answer')

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.askSideQuestion).toHaveBeenCalledTimes(2))
    expect(mocks.askSideQuestion).toHaveBeenLastCalledWith(
      'ses_1',
      'question A',
      expect.any(AbortSignal),
      'local',
    )
  })

  it('cancels the pending request when a replacement question is submitted', async () => {
    let resolveA: (value: string) => void = () => {}
    let resolveB: (value: string) => void = () => {}
    let signalA: AbortSignal | undefined
    let signalB: AbortSignal | undefined

    mocks.askSideQuestion
      .mockImplementationOnce((_sessionID: string, _question: string, signal?: AbortSignal) => {
        signalA = signal
        return new Promise<string>((resolve) => {
          resolveA = resolve
        })
      })
      .mockImplementationOnce((_sessionID: string, _question: string, signal?: AbortSignal) => {
        signalB = signal
        return new Promise<string>((resolve) => {
          resolveB = resolve
        })
      })

    renderDialog({ initialQuestion: 'question A' })

    await waitFor(() => expect(signalA).toBeDefined())

    fireEvent.change(screen.getByPlaceholderText('Ask a side question'), {
      target: { value: 'question B' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(mocks.askSideQuestion).toHaveBeenCalledTimes(2))
    expect(mocks.askSideQuestion).toHaveBeenLastCalledWith(
      'ses_1',
      'question B',
      expect.any(AbortSignal),
      'local',
    )
    expect(signalB).toBeDefined()
    expect(signalA?.aborted).toBe(true)

    resolveB('answer B')
    expect(await screen.findByText('answer B')).toBeInTheDocument()

    resolveA('answer A')
    await waitFor(() => expect(screen.queryByText('answer A')).not.toBeInTheDocument())
    expect(screen.getByText('answer B')).toBeInTheDocument()
  })

  it('aborts the in-flight request when unmounted', async () => {
    let capturedSignal: AbortSignal | undefined
    mocks.askSideQuestion.mockImplementation(
      (_sessionID: string, _question: string, signal?: AbortSignal) => {
        capturedSignal = signal
        return new Promise<string>(() => {})
      },
    )

    const { unmount } = renderDialog({ initialQuestion: 'why?' })

    await waitFor(() => expect(capturedSignal).toBeDefined())
    expect(capturedSignal?.aborted).toBe(false)

    unmount()

    expect(capturedSignal?.aborted).toBe(true)
  })
})
