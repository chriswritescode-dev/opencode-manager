import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { connectTestEventStream } from '@/test/render'
import { promptTextarea, renderPromptInput } from '@/test/promptInput'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'

const submitButton = () => document.querySelector('[data-submit-prompt]')
const controlsRow = () => screen.getByTestId('composer-controls-row')
const voiceMicButton = () => screen.queryByRole('button', { name: 'Start voice conversation' })
const keyButtons = () => screen.queryAllByRole('toolbar', { name: 'Insert' })

function assistantUsageMessage(tokens: SessionMessageAssistant['tokens']): SessionMessageAssistant {
  return {
    id: 'msg_assistant',
    type: 'assistant',
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
    content: [{ type: 'text', text: 'A reply' }],
    time: { created: 1, completed: 2 },
    tokens,
  }
}

describe('PromptInput composer layout', () => {
  it('anchors the activity bar in the gap above the controls row', async () => {
    useSessionStatus.getState().setStatus('test-session', { type: 'busy' })
    await renderPromptInput()

    const bar = await screen.findByRole('progressbar', { name: 'Session working' })
    expect(controlsRow()).toContainElement(bar)
    expect(controlsRow().firstElementChild).toBe(bar)
    expect(bar).toHaveClass('absolute', 'bottom-full')
    expect(promptTextarea().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('primary action placement', () => {
    it('omits the submit button while the prompt is empty', async () => {
      await renderPromptInput()

      expect(await screen.findByPlaceholderText('Send a message...')).toBeInTheDocument()
      expect(submitButton()).toBeNull()
    })

    it('renders the submit button after the textarea in the same row', async () => {
      await renderPromptInput()

      fireEvent.change(await screen.findByPlaceholderText('Send a message...'), { target: { value: 'hello' } })

      const textarea = promptTextarea()
      const button = submitButton()
      if (!(button instanceof HTMLElement)) throw new Error('submit button is missing')

      expect(button.parentElement).toBe(textarea.parentElement)
      expect(textarea.nextElementSibling).toBe(button)
      expect(button.parentElement?.contains(controlsRow())).toBe(false)
    })

    it('sends the typed prompt from the row button', async () => {
      const { fetchFake } = await renderPromptInput()

      fireEvent.change(await screen.findByPlaceholderText('Send a message...'), { target: { value: 'row send' } })
      fireEvent.click(screen.getByTitle('Send'))

      await waitFor(() => expect(promptTextarea()).toHaveValue(''))
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
        text: 'row send',
      })
    })

    it('queues from the row button while a response streams', async () => {
      await renderPromptInput({ isStreamingResponse: true })

      fireEvent.change(await screen.findByPlaceholderText('Send a message...'), { target: { value: 'follow-up' } })

      expect(screen.getByTitle('Queue message')).toBeInTheDocument()
    })

    it('shows View for a pending permission even while the prompt is empty', async () => {
      const { eventStream } = await renderPromptInput()
      await screen.findByPlaceholderText('Send a message...')
      await connectTestEventStream(eventStream)
      act(() => {
        eventStream?.message({
          id: 'evt_permission',
          created: 1,
          type: 'permission.asked',
          data: { id: 'permission-1', sessionID: 'test-session', action: 'bash', resources: ['echo'], metadata: {} },
          directory: '/test',
        })
      })

      const view = await screen.findByTitle('View pending permission')
      expect(view).toHaveTextContent('View')
      expect(view).toHaveAttribute('data-submit-prompt')
      expect(view.parentElement).toBe(promptTextarea().parentElement)
    })
  })

  describe('model visibility', () => {
    it.each([true, false])('keeps the model selector visible while the session is active (mobile: %s)', async (mobile) => {
      await renderPromptInput({ isSessionActive: true, mobile })

      expect(await screen.findByRole('button', { name: /Claude Sonnet 4\.5/ })).toBeInTheDocument()
    })
  })

  describe('model pill context usage', () => {
    it('shows the percentage with its tone and the meter on the model pill', async () => {
      await renderPromptInput({
        transcript: {
          messages: [assistantUsageMessage({ input: 80000, output: 4000, reasoning: 0, cache: { read: 0, write: 0 } })],
        },
      })

      const pill = await screen.findByRole('button', { name: /Claude Sonnet 4\.5, context 42% used/ })
      const usage = screen.getByTestId('model-pill-context-usage')

      expect(pill).toContainElement(usage)
      expect(usage).toHaveTextContent('42%')
      expect(usage).toHaveClass('text-success')
      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '42%' })
    })

    it.each([
      [100000, 'text-warning', '50%'],
      [176000, 'text-destructive', '88%'],
    ])('tints the usage from %i total tokens', async (totalTokens, tone, label) => {
      await renderPromptInput({
        transcript: {
          messages: [assistantUsageMessage({ input: totalTokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })],
        },
      })

      const usage = await screen.findByTestId('model-pill-context-usage')
      expect(usage).toHaveClass(tone)
      expect(usage).toHaveTextContent(label)
    })

    it('caps the meter at full width when usage exceeds the context window', async () => {
      await renderPromptInput({
        transcript: {
          messages: [assistantUsageMessage({ input: 260000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })],
        },
      })

      await screen.findByTestId('model-pill-context-usage')
      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '100%' })
    })

    it('falls back to a compact token count without a known context limit', async () => {
      await renderPromptInput({
        models: [{ id: 'claude-sonnet-4-5', providerID: 'anthropic', name: 'Claude Sonnet 4.5', contextLimit: 0 }],
        transcript: {
          messages: [assistantUsageMessage({ input: 12400, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })],
        },
      })

      expect(await screen.findByTestId('model-pill-context-usage')).toHaveTextContent('12k')
      expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '0%' })
    })

    it('measures usage up to the staged revert boundary', async () => {
      renderPromptInput({
        sessionRevert: { messageID: 'msg_reverted' },
        transcript: {
          messages: [
            assistantUsageMessage({ input: 80000, output: 4000, reasoning: 0, cache: { read: 0, write: 0 } }),
            { ...assistantUsageMessage({ input: 176000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }), id: 'msg_reverted' },
          ],
        },
      })

      const usage = await screen.findByTestId('model-pill-context-usage')
      expect(usage).toHaveTextContent('42%')
    })

    it('hides the usage without context data', async () => {
      await renderPromptInput()

      expect(await screen.findByRole('button', { name: 'Claude Sonnet 4.5' })).toBeInTheDocument()
      expect(screen.queryByTestId('model-pill-context-usage')).not.toBeInTheDocument()
      expect(screen.queryByTestId('context-usage-meter')).not.toBeInTheDocument()
    })
  })

  describe('mobile key bar', () => {
    it('replaces the agent and model selectors with keys in the controls row while focused', async () => {
      await renderPromptInput({ mobile: true })

      expect(await screen.findByPlaceholderText('Send a message...')).toBeInTheDocument()
      expect(keyButtons()).toHaveLength(0)
      expect(screen.getByRole('button', { name: /Claude Sonnet 4\.5/ })).toBeInTheDocument()

      fireEvent.focus(promptTextarea())

      expect(keyButtons()).toHaveLength(1)
      expect(controlsRow().firstElementChild).toContainElement(keyButtons()[0])
      expect(screen.getByRole('button', { name: 'cmd /' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'mention @' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'bash !' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Claude Sonnet 4\.5/ })).not.toBeInTheDocument()
    })

    it('restores the agent and model selectors after the prompt blurs', async () => {
      await renderPromptInput({ mobile: true })

      fireEvent.focus(await screen.findByPlaceholderText('Send a message...'))
      expect(screen.queryByRole('button', { name: /Claude Sonnet 4\.5/ })).not.toBeInTheDocument()

      fireEvent.blur(promptTextarea())

      await waitFor(() => {
        expect(screen.queryByRole('toolbar', { name: 'Insert' })).not.toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: /Claude Sonnet 4\.5/ })).toBeInTheDocument()
    })

    it('keeps the composer tools button at the bottom of the transcript', async () => {
      await renderPromptInput({ mobile: true })

      expect(await screen.findByRole('button', { name: 'Composer options' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument()
    })

    it('keeps the voice button and composer tools on the right side of the controls row', async () => {
      await renderPromptInput({ mobile: true })

      fireEvent.focus(await screen.findByPlaceholderText('Send a message...'))

      const actions = controlsRow().lastElementChild
      if (!(actions instanceof HTMLElement)) throw new Error('actions row is missing')
      expect(actions).toContainElement(voiceMicButton())
      expect(actions).toContainElement(screen.getByRole('button', { name: 'Composer options' }))
    })
  })

  describe('mobile voice button', () => {
    it('renders the mobile mic alongside Send when the prompt has content', async () => {
      await renderPromptInput({ mobile: true })

      fireEvent.change(await screen.findByPlaceholderText('Send a message...'), { target: { value: 'hello' } })

      expect(submitButton()).not.toBeNull()
      expect(voiceMicButton()).not.toBeNull()
      const actions = controlsRow().lastElementChild
      if (!(actions instanceof HTMLElement)) throw new Error('actions row is missing')
      expect(actions).toContainElement(voiceMicButton())
    })

    it('hides the mic while a permission is pending', async () => {
      const { eventStream } = await renderPromptInput({ mobile: true })
      await screen.findByPlaceholderText('Send a message...')
      await connectTestEventStream(eventStream)
      act(() => {
        eventStream?.message({
          id: 'evt_permission',
          created: 1,
          type: 'permission.asked',
          data: { id: 'permission-1', sessionID: 'test-session', action: 'bash', resources: ['echo'], metadata: {} },
          directory: '/test',
        })
      })

      expect(await screen.findByTitle('View pending permission')).toBeInTheDocument()
      expect(voiceMicButton()).toBeNull()
    })
  })

  describe('control sizing', () => {
    it('keeps the mic at 44px before and after the prompt gains focus on mobile', async () => {
      await renderPromptInput({ mobile: true })

      await screen.findByPlaceholderText('Send a message...')
      const micBeforeFocus = voiceMicButton()
      expect(micBeforeFocus).toHaveClass('min-h-11', 'min-w-11')
      expect(micBeforeFocus).not.toHaveClass('min-h-[44px]')

      fireEvent.focus(promptTextarea())

      const micAfterFocus = voiceMicButton()
      expect(micAfterFocus).toHaveClass('min-h-11', 'min-w-11')
      expect(micAfterFocus).not.toHaveClass('min-h-[44px]')
    })

    it('keeps the key buttons at 36px after the prompt gains focus on mobile', async () => {
      await renderPromptInput({ mobile: true })

      fireEvent.focus(await screen.findByPlaceholderText('Send a message...'))

      const commandKey = screen.getByRole('button', { name: 'cmd /' })
      expect(commandKey).toHaveClass('min-h-9')
      expect(commandKey).not.toHaveClass('min-h-[44px]')
    })

    it('sizes the submit button at 36px on mobile', async () => {
      await renderPromptInput({ mobile: true })

      fireEvent.change(await screen.findByPlaceholderText('Send a message...'), { target: { value: 'hello' } })

      const send = submitButton()
      if (!(send instanceof HTMLElement)) throw new Error('submit button is missing')
      expect(send).toHaveClass('h-9')
      expect(send).not.toHaveClass('min-h-[44px]')
    })
  })
})
