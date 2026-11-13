import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { CommandInfo } from '@opencode-manager/shared/opencode'
import type { PromptInputHandle } from './PromptInput'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { installMatchMedia } from '@/test/browserFakes'
import { makeAgent, promptTextarea, renderPromptInput } from '@/test/promptInput'
import type { PromptInputFixture } from '@/test/promptInput'

const reviewCommand: CommandInfo = { name: 'review', description: 'Review' }

function mainAgent(id: string) {
  return makeAgent({ id, mode: 'primary' })
}

async function renderCommandInput(fixture: PromptInputFixture = {}) {
  return renderPromptInput({
    commands: [reviewCommand],
    agents: [mainAgent('build'), mainAgent('plan'), makeAgent({ id: 'reviewer', description: 'Reviewer' })],
    ...fixture,
  })
}

function selectedSuggestionLabel(): string {
  const list = screen.getByTestId('prompt-suggestions')
  for (const row of list.querySelectorAll('[data-index]')) {
    const button = row.querySelector('button')
    if (!button) continue
    const isSelected = button.className.split(/\s+/).some((token) => token === 'bg-primary' || token === 'bg-primary/15')
    if (isSelected) return button.textContent ?? ''
  }
  return ''
}

async function attachImage(container: HTMLElement) {
  const fileInput = container.querySelector('input[type="file"]')
  if (!(fileInput instanceof HTMLInputElement)) throw new Error('file input is missing')
  fireEvent.change(fileInput, { target: { files: [new File(['img'], 'pic.png', { type: 'image/png' })] } })
  await screen.findByText('pic.png')
}

describe('PromptInput command submission', () => {
  it('focuses the prompt on open with a fine pointer', async () => {
    installMatchMedia(true)
    await renderCommandInput()

    expect(promptTextarea()).toHaveFocus()
  })

  it('does not focus the prompt on open on touch devices', async () => {
    installMatchMedia(false)
    await renderCommandInput()

    expect(promptTextarea()).not.toHaveFocus()
  })

  it('does not take focus from an element that already has it', async () => {
    installMatchMedia(true)
    const other = document.createElement('button')
    document.body.appendChild(other)
    other.focus()

    await renderCommandInput()

    expect(other).toHaveFocus()
    other.remove()
  })

  it('announces session activity changes to screen readers', async () => {
    const { rerenderWith } = await renderCommandInput()

    expect(screen.getByRole('status').textContent).toBe('')

    await rerenderWith({ isSessionActive: true })
    expect(screen.getByRole('status')).toHaveTextContent('Session working')

    await rerenderWith({ isSessionActive: false })
    useSessionStatus.getState().setShellRunning('shell-1', 'test-session', '/repo')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Background tasks running'))
  })

  it('disables submit and does not run a command while the model is not ready', async () => {
    const { fetchFake } = await renderCommandInput({ deferProviders: true })

    fireEvent.change(promptTextarea(), { target: { value: '/review' } })

    const sendButton = screen.getByTitle('Send')
    expect(sendButton).toBeDisabled()
    fireEvent.click(sendButton)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
  })

  it('sends parsed command attachments and offsets to the command endpoint', async () => {
    const { fetchFake, container } = await renderCommandInput({ files: ['src/App.tsx'] })

    fireEvent.change(promptTextarea(), { target: { value: '@App' } })
    await waitFor(() => expect(screen.getByTestId('prompt-suggestions')).toBeInTheDocument())
    fireEvent.keyDown(promptTextarea(), { key: 'Enter' })
    await waitFor(() => expect(promptTextarea()).toHaveValue('@App.tsx '))

    await attachImage(container)

    fireEvent.change(promptTextarea(), { target: { value: '/review @App.tsx @reviewer' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')?.body).toMatchObject({
      name: 'review',
      text: '@App.tsx @reviewer',
      agents: [{ name: 'reviewer', mention: { start: 9, end: 18, text: '@reviewer' } }],
      skills: [],
      files: expect.arrayContaining([
        { uri: 'file:///test/src/App.tsx', name: 'App.tsx', mention: { start: 0, end: 8, text: '@App.tsx' } },
        expect.objectContaining({ name: 'pic.png', uri: expect.stringMatching(/^data:image\/png/) }),
      ]),
    })
  })

  it('runs a command whose arguments span multiple lines', async () => {
    const { fetchFake } = await renderCommandInput()

    fireEvent.change(promptTextarea(), { target: { value: '/review first line\nsecond line' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')?.body).toMatchObject({
      name: 'review',
      text: 'first line\nsecond line',
    })
  })

  it('submits a known built-in command on plain Enter', async () => {
    const commandActions = { ...createActions(), askSideQuestion: vi.fn() }
    await renderCommandInput({ commandActions })

    fireEvent.change(promptTextarea(), { target: { value: '/btw first line\nsecond line' } })
    fireEvent.keyDown(promptTextarea(), { key: 'Enter' })

    await waitFor(() => expect(commandActions.askSideQuestion).toHaveBeenCalledWith('first line\nsecond line'))
  })

  it('does not submit a known built-in command on Shift+Enter', async () => {
    const commandActions = { ...createActions(), askSideQuestion: vi.fn() }
    await renderCommandInput({ commandActions })

    fireEvent.change(promptTextarea(), { target: { value: '/btw hi' } })
    fireEvent.keyDown(promptTextarea(), { key: 'Enter', shiftKey: true })

    expect(commandActions.askSideQuestion).not.toHaveBeenCalled()
    expect(promptTextarea()).toHaveValue('/btw hi')
  })

  it.each(['hello there', '/bt hi', '/unknown hi'])('does not submit %j on plain Enter', async (value) => {
    const { fetchFake } = await renderCommandInput()

    fireEvent.change(promptTextarea(), { target: { value } })
    fireEvent.keyDown(promptTextarea(), { key: 'Enter' })

    expect(promptTextarea()).toHaveValue(value)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
  })

  it('preserves the submitted command text when the command submission fails', async () => {
    const { fetchFake } = await renderCommandInput({
      runCommand: () => ({ status: 400, json: { error: 'command failed' } }),
    })

    fireEvent.change(promptTextarea(), { target: { value: '/review' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(promptTextarea()).toHaveValue('/review')
  })

  it('switches to the next primary agent for /agent without running a command', async () => {
    const { fetchFake } = await renderCommandInput()

    fireEvent.change(promptTextarea(), { target: { value: '/agent' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(useSessionAgentStore.getState().agents['test-session']).toBe('plan'))
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
  })

  it('reports when /variants is used with a model that has no variants', async () => {
    await renderCommandInput()

    fireEvent.change(promptTextarea(), { target: { value: '/variants' } })
    fireEvent.click(screen.getByTitle('Send'))

    expect(await screen.findByText('The selected model has no variants')).toBeInTheDocument()
  })

  it('cycles variants for /variants when the model has them', async () => {
    const { fetchFake } = await renderCommandInput({
      models: [
        {
          id: 'claude-sonnet-4-5',
          providerID: 'anthropic',
          name: 'Claude Sonnet 4.5',
          variants: ['high', 'low'],
        },
      ],
    })

    fireEvent.change(promptTextarea(), { target: { value: '/variants' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/providers/model-state')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toMatchObject({
      variant: { model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }, value: 'high' },
    })
    expect(screen.queryByText('The selected model has no variants')).not.toBeInTheDocument()
  })

  it('opens the model picker through the imperative handle while the session is active', async () => {
    const ref = createRef<PromptInputHandle>()
    await renderCommandInput({ promptRef: ref, isSessionActive: true })

    expect(screen.queryByText('Select model')).not.toBeInTheDocument()

    act(() => {
      ref.current?.openModelPicker()
    })

    expect(await screen.findByText('Select model')).toBeInTheDocument()
  })

  it('resets bash mode through the imperative clearPrompt', async () => {
    const ref = createRef<PromptInputHandle>()
    await renderCommandInput({ promptRef: ref })

    fireEvent.change(promptTextarea(), { target: { value: '!' } })
    expect(promptTextarea()).toHaveValue('!')
    expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')

    act(() => {
      ref.current?.clearPrompt()
    })

    expect(promptTextarea()).toHaveValue('')
    expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
  })

  it('exits bash mode on Escape while idle and keeps the attachments', async () => {
    const { container } = await renderCommandInput()

    fireEvent.change(promptTextarea(), { target: { value: '!' } })
    expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')

    await attachImage(container)
    expect(screen.getByText('pic.png')).toBeInTheDocument()

    fireEvent.keyDown(promptTextarea(), { key: 'Escape' })

    expect(promptTextarea()).toHaveValue('')
    expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('keeps attachments and clears only the text when a built-in command is submitted', async () => {
    const { container } = await renderCommandInput()

    await attachImage(container)

    fireEvent.change(promptTextarea(), { target: { value: '/btw hi' } })
    fireEvent.click(screen.getByTitle('Send'))

    expect(await screen.findByText('Built-in commands do not use attachments; they were kept')).toBeInTheDocument()
    expect(promptTextarea()).toHaveValue('')
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('clears the prompt for a built-in command without attachments', async () => {
    await renderCommandInput()

    fireEvent.change(promptTextarea(), { target: { value: '/btw hi' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
    expect(screen.queryByText('Built-in commands do not use attachments; they were kept')).not.toBeInTheDocument()
  })

  it.each([
    [true, 'ArrowUp', 'ArrowDown'],
    [false, 'ArrowDown', 'ArrowUp'],
  ])('moves the command selection with the arrows (mobile: %s)', async (mobile, forward, backward) => {
    await renderCommandInput({
      mobile,
      commands: [
        { name: 'alpha', description: 'Alpha' },
        { name: 'beta', description: 'Beta' },
        { name: 'gamma', description: 'Gamma' },
      ],
    })

    fireEvent.change(promptTextarea(), { target: { value: '/', selectionStart: 1 } })

    await waitFor(() => expect(screen.getByTestId('prompt-suggestions')).toBeInTheDocument())
    const initial = selectedSuggestionLabel()
    expect(initial).not.toBe('')

    fireEvent.keyDown(promptTextarea(), { key: forward })
    await waitFor(() => expect(selectedSuggestionLabel()).not.toBe(initial))

    fireEvent.keyDown(promptTextarea(), { key: backward })
    await waitFor(() => expect(selectedSuggestionLabel()).toBe(initial))
  })

  it('keeps the composer frame out of a compositing layer so the iOS caret stays aligned', async () => {
    await renderCommandInput()

    const frame = promptTextarea().closest('.isolate')
    if (!(frame instanceof HTMLElement)) throw new Error('composer frame is missing')
    const tokens = frame.className.split(/\s+/)

    expect(tokens).not.toContain('transition-all')
    expect(tokens.some((token) => token.startsWith('backdrop-blur'))).toBe(false)
    expect(tokens.some((token) => token.startsWith('opacity-'))).toBe(false)
    expect(tokens).toContain('before:backdrop-blur-md')
  })

  describe('mobile keybar', () => {
    it('shows only while the prompt is focused on mobile', async () => {
      await renderCommandInput({ mobile: true })

      expect(screen.queryByRole('toolbar', { name: 'Insert' })).not.toBeInTheDocument()

      fireEvent.focus(promptTextarea())
      expect(screen.getByRole('toolbar', { name: 'Insert' })).toBeInTheDocument()
    })

    it('is not shown on desktop', async () => {
      await renderCommandInput()

      fireEvent.focus(promptTextarea())
      expect(screen.queryByRole('toolbar', { name: 'Insert' })).not.toBeInTheDocument()
    })

    it('inserts a separated trigger at the cursor', async () => {
      await renderCommandInput({ mobile: true })

      fireEvent.change(promptTextarea(), { target: { value: 'hello world' } })
      fireEvent.focus(promptTextarea())
      promptTextarea().setSelectionRange(5, 5)

      fireEvent.click(screen.getByRole('button', { name: 'mention @' }))
      expect(promptTextarea()).toHaveValue('hello @ world')

      fireEvent.change(promptTextarea(), { target: { value: 'hello' } })
      promptTextarea().setSelectionRange(5, 5)
      fireEvent.click(screen.getByRole('button', { name: 'cmd /' }))
      expect(promptTextarea()).toHaveValue('hello /')
    })

    it('enables bash only for an empty prompt and toggles bash mode', async () => {
      await renderCommandInput({ mobile: true })

      expect(promptTextarea()).toHaveAttribute('autocomplete', 'off')
      expect(promptTextarea()).toHaveAttribute('autocorrect', 'off')
      expect(promptTextarea()).toHaveAttribute('autocapitalize', 'off')
      expect(promptTextarea()).toHaveAttribute('spellcheck', 'false')
      fireEvent.focus(promptTextarea())
      fireEvent.change(promptTextarea(), { target: { value: 'text' } })
      expect(screen.getByRole('button', { name: 'bash !' })).toBeDisabled()

      fireEvent.change(promptTextarea(), { target: { value: '' } })
      const bashKey = screen.getByRole('button', { name: 'bash !' })
      expect(bashKey).toBeEnabled()

      fireEvent.click(bashKey)
      expect(promptTextarea()).toHaveValue('!')
      expect(screen.getByTestId('composer-mode-badge')).toHaveTextContent('BASH')
      expect(screen.getByRole('button', { name: 'cmd /' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'bash !' }))
      expect(promptTextarea()).toHaveValue('')
      expect(screen.queryByTestId('composer-mode-badge')).not.toBeInTheDocument()
    })
  })
})

function createActions() {
  const action = () => vi.fn()
  return {
    showSessions: action(),
    showModels: action(),
    newSession: action(),
    toggleDetails: action(),
    exportSession: action(),
    copyTranscript: action(),
    compact: action(),
    askSideQuestion: action(),
    renameSession: action(),
    forkSession: action(),
    jumpToMessage: action(),
    undo: action(),
    redo: action(),
    cycleAgent: action(),
    cycleVariant: action(),
    showMcp: action(),
    showSkills: action(),
    showSettings: action(),
    connectProvider: action(),
    showWalkthrough: action(),
  }
}
