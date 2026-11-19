import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { installMatchMedia } from '@/test/browserFakes'
import { makeUserMessage } from '@/test/fixtures/api'
import { SessionMessagePickerDialog } from './SessionMessagePickerDialog'

function userMessage(id: string, text: string, created = 1000): SessionMessageInfo {
  return makeUserMessage({ id, text, time: { created } })
}

function assistantMessage(id: string, text: string): SessionMessageInfo {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
    content: [{ type: 'text', text }],
    time: { created: 1000 },
  }
}

const renderPicker = (
  props: Partial<React.ComponentProps<typeof SessionMessagePickerDialog>> = {},
) =>
  render(
    <SessionMessagePickerDialog
      open
      onOpenChange={vi.fn()}
      title="Fork session"
      messages={[]}
      onSelect={vi.fn()}
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
        <SessionMessagePickerDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false)
          }}
          title="Fork session"
          messages={[]}
          onSelect={vi.fn()}
        />
      )}
    </>
  )
}

describe('SessionMessagePickerDialog', () => {
  it('focuses its search on open and returns focus to the previous element on Escape', async () => {
    installMatchMedia(true)
    render(<FocusHost />)
    const prompt = screen.getByLabelText('prompt')
    prompt.focus()

    fireEvent.click(screen.getByText('open'))

    const search = await screen.findByPlaceholderText('Search messages')
    await waitFor(() => expect(search).toHaveFocus())

    fireEvent.keyDown(search, { key: 'Escape' })

    await waitFor(() => expect(prompt).toHaveFocus())
  })

  it('lists only user messages, newest first', () => {
    renderPicker({
      messages: [
        userMessage('old', 'older prompt', 1000),
        assistantMessage('assistant', 'reply'),
        userMessage('new', 'newer prompt', 2000),
      ],
    })

    const older = screen.getByText('older prompt')
    const newer = screen.getByText('newer prompt')

    expect(screen.queryByText('reply')).not.toBeInTheDocument()
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('narrows the rows with the search query', () => {
    renderPicker({
      messages: [userMessage('a', 'alpha prompt'), userMessage('b', 'beta prompt')],
    })

    expect(screen.getByText('alpha prompt')).toBeInTheDocument()
    expect(screen.getByText('beta prompt')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search messages'), {
      target: { value: 'beta' },
    })

    expect(screen.queryByText('alpha prompt')).not.toBeInTheDocument()
    expect(screen.getByText('beta prompt')).toBeInTheDocument()
  })

  it('calls onSelect with the message id when a row is clicked', () => {
    const onSelect = vi.fn()
    renderPicker({ messages: [userMessage('msg-1', 'hello')], onSelect })

    fireEvent.click(screen.getByText('hello'))

    expect(onSelect).toHaveBeenCalledWith('msg-1')
  })

  it('calls onSelect with undefined from the leading row', () => {
    const onSelect = vi.fn()
    renderPicker({
      messages: [userMessage('msg-1', 'hello')],
      leadingOptionLabel: 'Entire conversation',
      onSelect,
    })

    fireEvent.click(screen.getByText('Entire conversation'))

    expect(onSelect).toHaveBeenCalledWith(undefined)
  })

  it('shows an empty state when no messages match', () => {
    renderPicker({ messages: [assistantMessage('a', 'reply')] })

    expect(screen.getByText('No messages')).toBeInTheDocument()
  })

  it('shows a loading state instead of the rows while loading', () => {
    renderPicker({ messages: [userMessage('msg-1', 'hello')], loading: true })

    expect(screen.getByText('Loading messages…')).toBeInTheDocument()
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
    expect(screen.queryByText('No messages')).not.toBeInTheDocument()
  })
})
