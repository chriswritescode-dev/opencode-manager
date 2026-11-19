import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useComposerDraftStore } from '@/stores/composerDraftStore'
import { promptTextarea, renderPromptInput } from '@/test/promptInput'
import type { FetchRouteResult } from '@/test/fetchFake'

const commandFixtures = [
  { name: 'alpha', description: 'Alpha' },
  { name: 'beta', description: 'Beta' },
]

async function attachImage(container: HTMLElement) {
  const fileInput = container.querySelector('input[type="file"]')
  if (!(fileInput instanceof HTMLInputElement)) throw new Error('file input is missing')
  fireEvent.change(fileInput, { target: { files: [new File(['img'], 'pic.png', { type: 'image/png' })] } })
  await screen.findByText('pic.png')
}

function deferredRoute() {
  let resolve: (result: FetchRouteResult) => void = () => {}
  const respond = () => new Promise<FetchRouteResult>((settle) => {
    resolve = settle
  })
  return { respond, resolve: (result: FetchRouteResult) => resolve(result) }
}

describe('PromptInput per-session composer draft', () => {
  it('keeps the typed draft of each session', async () => {
    const { rerenderWith } = await renderPromptInput({ sessionID: 'session-a' })

    fireEvent.change(promptTextarea(), { target: { value: 'draft for A' } })

    await rerenderWith({ sessionID: 'session-b' })
    expect(promptTextarea()).toHaveValue('')

    fireEvent.change(promptTextarea(), { target: { value: 'draft for B' } })

    await rerenderWith({ sessionID: 'session-a' })
    expect(promptTextarea()).toHaveValue('draft for A')

    await rerenderWith({ sessionID: 'session-b' })
    expect(promptTextarea()).toHaveValue('draft for B')
  })

  it('keeps bash mode and attachments of each session', async () => {
    const { rerenderWith, container } = await renderPromptInput({ sessionID: 'session-a' })

    fireEvent.change(promptTextarea(), { target: { value: '!' } })
    await attachImage(container)
    expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')

    await rerenderWith({ sessionID: 'session-b' })
    expect(promptTextarea()).toHaveValue('')
    expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
    expect(screen.queryByText('pic.png')).not.toBeInTheDocument()

    await rerenderWith({ sessionID: 'session-a' })
    expect(promptTextarea()).toHaveValue('!')
    expect(screen.getByPlaceholderText('Enter bash command...')).toBeInTheDocument()
    expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('sends the restored draft to the session that owns it and clears only that draft', async () => {
    const { rerenderWith } = await renderPromptInput({ sessionID: 'session-a' })

    fireEvent.change(promptTextarea(), { target: { value: 'draft for A' } })

    await rerenderWith({ sessionID: 'session-b' })
    fireEvent.change(promptTextarea(), { target: { value: 'draft for B' } })

    await rerenderWith({ sessionID: 'session-a' })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
    expect(useComposerDraftStore.getState().getDraft('session-a').prompt).toBe('')

    await rerenderWith({ sessionID: 'session-b' })
    expect(promptTextarea()).toHaveValue('draft for B')
  })

  it('clears a submitted draft after its session unmounted before the send resolved', async () => {
    const send = deferredRoute()
    const { rerenderWith } = await renderPromptInput({ sessionID: 'session-a', sendPrompt: send.respond })

    fireEvent.change(promptTextarea(), { target: { value: 'sent while leaving' } })
    fireEvent.click(screen.getByTitle('Send'))
    expect(useComposerDraftStore.getState().getDraft('session-a').prompt).toBe('sent while leaving')

    await rerenderWith({ sessionID: 'session-b' })
    await act(async () => {
      send.resolve({ json: { data: { id: 'inbox_1', sessionID: 'session-a', type: 'user', time: { created: 1 }, payload: { text: '' } } } })
    })

    await rerenderWith({ sessionID: 'session-a' })
    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
  })

  it('clears a submitted bash command after its session unmounted before the send completed', async () => {
    const shell = deferredRoute()
    const { rerenderWith } = await renderPromptInput({ sessionID: 'session-a', sendShell: shell.respond })

    fireEvent.change(promptTextarea(), { target: { value: '!' } })
    fireEvent.change(screen.getByPlaceholderText('Enter bash command...'), { target: { value: '!ls' } })
    fireEvent.click(screen.getByTitle('Send'))

    await rerenderWith({ sessionID: 'session-b' })
    await act(async () => {
      shell.resolve({ status: 204 })
    })

    await rerenderWith({ sessionID: 'session-a' })
    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
    expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
  })

  it('keeps text typed after the submit when the send resolves', async () => {
    const send = deferredRoute()
    await renderPromptInput({ sessionID: 'session-a', sendPrompt: send.respond })

    fireEvent.change(promptTextarea(), { target: { value: 'sent message' } })
    fireEvent.click(screen.getByTitle('Send'))
    fireEvent.change(promptTextarea(), { target: { value: 'sent message plus an edit' } })

    await act(async () => {
      send.resolve({ json: { data: { id: 'inbox_1', sessionID: 'session-a', type: 'user', time: { created: 1 }, payload: { text: '' } } } })
    })

    await waitFor(() => expect(promptTextarea()).toHaveValue('sent message plus an edit'))
    expect(useComposerDraftStore.getState().getDraft('session-a').prompt).toBe('sent message plus an edit')
  })

  it('keeps the draft when Escape is pressed while the session is idle', async () => {
    await renderPromptInput({ sessionID: 'session-a' })

    fireEvent.change(promptTextarea(), { target: { value: 'an important draft' } })
    fireEvent.keyDown(promptTextarea(), { key: 'Escape' })

    expect(promptTextarea()).toHaveValue('an important draft')
  })

  it('reports suggestion list changes instead of clearing on Escape', async () => {
    const onSuggestionsOpenChange = vi.fn()
    await renderPromptInput({ sessionID: 'session-a', commands: commandFixtures, onSuggestionsOpenChange })
    expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(promptTextarea(), { target: { value: '/al', selectionStart: 3 } })

    await waitFor(() => expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(true))
    expect(promptTextarea()).toHaveValue('/al')
    expect(screen.getByTestId('prompt-suggestions')).toHaveTextContent('alpha')

    fireEvent.keyDown(promptTextarea(), { key: 'Escape' })

    await waitFor(() => expect(onSuggestionsOpenChange).toHaveBeenLastCalledWith(false))
    expect(promptTextarea()).toHaveValue('/al')
  })

  it('labels the attachment remove button with the filename', async () => {
    const { container } = await renderPromptInput({ sessionID: 'session-a' })

    await attachImage(container)

    expect(screen.getByRole('button', { name: 'Remove pic.png' })).toBeInTheDocument()
  })
})
