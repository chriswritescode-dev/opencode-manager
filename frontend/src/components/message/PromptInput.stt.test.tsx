import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { UseVoiceConversationInput, VoiceConversationController } from '@/hooks/useVoiceConversation'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import type { VoiceConversationFactory } from './VoiceConversation'
import { useComposerDraftStore } from '@/stores/composerDraftStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { useSessionAgentStore } from '@/stores/sessionAgentStore'
import { createVoiceConversationControllerMock } from '@/test/test-utils'
import { promptTextarea, renderPromptInput } from '@/test/promptInput'
import type { FetchRouteResult } from '@/test/fetchFake'

interface VoiceHarness {
  factory: VoiceConversationFactory
  setController: (controller: Partial<VoiceConversationController>, capturedText?: string) => void
  input: () => UseVoiceConversationInput
}

function voiceHarness(): VoiceHarness {
  let controller: Partial<VoiceConversationController> = {}
  let capturedText = 'half a sentence'
  let latest: UseVoiceConversationInput | undefined
  const factory: VoiceConversationFactory = (input) => {
    latest = input
    return createVoiceConversationControllerMock({
      ...controller,
      editInTextBox: () => input.onEditInTextBox(capturedText),
    })
  }
  return {
    factory,
    setController: (next, text) => {
      controller = next
      if (text !== undefined) capturedText = text
    },
    input: () => {
      if (!latest) throw new Error('useVoiceConversation was not called')
      return latest
    },
  }
}

function assistantReply(tokens: SessionMessageAssistant['tokens']): SessionMessageAssistant {
  return {
    id: 'msg_voice_1',
    type: 'assistant',
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
    content: [{ type: 'text', text: 'hello there' }],
    time: { created: 1, completed: 2 },
    tokens,
  }
}

function deferredRoute() {
  let resolve: (result: FetchRouteResult) => void = () => {}
  const respond = () => new Promise<FetchRouteResult>((settle) => {
    resolve = settle
  })
  return { respond, resolve: (result: FetchRouteResult) => resolve(result) }
}

function promptInboxBody(sessionID: string) {
  return { data: { id: 'inbox_1', sessionID, type: 'user', time: { created: 1 }, payload: { text: '' } } }
}

describe('PromptInput voice conversation', () => {
  describe('microphone availability', () => {
    it.each([true, false])('shows the microphone when speech-to-text is enabled (mobile: %s)', async (mobile) => {
      const voice = voiceHarness()
      await renderPromptInput({ mobile, voiceConversation: voice.factory })

      expect(screen.getByRole('button', { name: 'Start voice conversation' })).toBeInTheDocument()
    })

    it('hides the microphone when speech-to-text is disabled', async () => {
      const voice = voiceHarness()
      await renderPromptInput({ stt: 'disabled', voiceConversation: voice.factory })

      expect(screen.queryByRole('button', { name: 'Start voice conversation' })).toBeNull()
    })

    it('hides the microphone when the browser cannot capture speech', async () => {
      const voice = voiceHarness()
      await renderPromptInput({ stt: 'unsupported', voiceConversation: voice.factory })

      expect(screen.queryByRole('button', { name: 'Start voice conversation' })).toBeNull()
    })

    it('starts the conversation when the microphone is pressed', async () => {
      const voice = voiceHarness()
      const controller = createVoiceConversationControllerMock()
      voice.setController(controller)
      await renderPromptInput({ voiceConversation: voice.factory })

      fireEvent.click(screen.getByRole('button', { name: 'Start voice conversation' }))

      expect(controller.start).toHaveBeenCalledTimes(1)
    })
  })

  it('passes the published transcript to the voice conversation', async () => {
    const voice = voiceHarness()
    await renderPromptInput({
      voiceConversation: voice.factory,
      transcript: { messages: [assistantReply({ input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } })], status: 'busy' },
    })

    expect(voice.input().messages).toHaveLength(1)
    expect(voice.input().status).toBe('busy')
  })

  describe('while a conversation is active', () => {
    it('replaces the composer with the conversation bar and keeps the draft after exit', async () => {
      const onVoiceConversationActiveChange = vi.fn()
      const voice = voiceHarness()
      const { rerenderWith } = await renderPromptInput({ voiceConversation: voice.factory, onVoiceConversationActiveChange })

      fireEvent.change(promptTextarea(), { target: { value: 'keep this draft' } })

      voice.setController({ isActive: true, phase: 'listening', label: 'Listening' })
      await rerenderWith()

      expect(screen.queryByPlaceholderText('Send a message...')).toBeNull()
      expect(screen.getByText('Listening')).toBeInTheDocument()
      expect(onVoiceConversationActiveChange).toHaveBeenLastCalledWith(true)

      voice.setController({})
      await rerenderWith()

      expect(promptTextarea()).toHaveValue('keep this draft')
      expect(onVoiceConversationActiveChange).toHaveBeenLastCalledWith(false)
    })

    it('moves the captured transcript into the text box', async () => {
      const voice = voiceHarness()
      const { rerenderWith } = await renderPromptInput({ voiceConversation: voice.factory })

      voice.setController({ isActive: true, phase: 'listening', canEditInTextBox: true }, 'dictated words')
      await rerenderWith()
      fireEvent.click(screen.getByRole('button', { name: 'Edit in text box' }))

      voice.setController({})
      await rerenderWith()

      expect(promptTextarea()).toHaveValue('dictated words')
    })

    it('appends the captured transcript after an existing draft', async () => {
      const voice = voiceHarness()
      const { rerenderWith } = await renderPromptInput({ voiceConversation: voice.factory })

      fireEvent.change(promptTextarea(), { target: { value: 'draft' } })

      voice.setController({ isActive: true, phase: 'listening', canEditInTextBox: true }, 'dictated words')
      await rerenderWith()
      fireEvent.click(screen.getByRole('button', { name: 'Edit in text box' }))

      voice.setController({})
      await rerenderWith()

      expect(promptTextarea()).toHaveValue('draft dictated words')
    })

    it('focuses the text box with the cursor after the transcript once the conversation closes', async () => {
      const voice = voiceHarness()
      const { rerenderWith } = await renderPromptInput({ voiceConversation: voice.factory })

      fireEvent.change(promptTextarea(), { target: { value: 'draft' } })

      voice.setController({ isActive: true, phase: 'listening', canEditInTextBox: true }, 'dictated words')
      await rerenderWith()
      fireEvent.click(screen.getByRole('button', { name: 'Edit in text box' }))

      voice.setController({})
      await rerenderWith()

      await waitFor(() => {
        const input = promptTextarea()
        expect(input).toHaveFocus()
        expect(input.selectionStart).toBe('draft dictated words'.length)
        expect(input.selectionEnd).toBe('draft dictated words'.length)
      })
    })
  })

  describe('sending a voice turn', () => {
    it('queues the turn while the session is busy and leaves the draft untouched', async () => {
      const voice = voiceHarness()
      const { fetchFake, rerenderWith } = await renderPromptInput({ voiceConversation: voice.factory })

      fireEvent.change(promptTextarea(), { target: { value: 'my draft' } })

      await voice.input().sendTurn('add a retry', { busy: true })

      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
        text: 'add a retry',
        delivery: 'queue',
      })
      await rerenderWith()
      expect(promptTextarea()).toHaveValue('my draft')
      expect(useSessionAgentStore.getState().agents['test-session']).toBe('build')
    })

    it('sends the turn without a delivery while the session is idle', async () => {
      const voice = voiceHarness()
      const { fetchFake } = await renderPromptInput({ voiceConversation: voice.factory })

      await voice.input().sendTurn('add a retry', { busy: false })

      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
        text: 'add a retry',
      })
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).not.toHaveProperty('delivery')
    })

    it('rejects when the send fails so the conversation can report it', async () => {
      const voice = voiceHarness()
      await renderPromptInput({
        voiceConversation: voice.factory,
        sendPrompt: () => ({ status: 500, json: { error: 'offline' } }),
      })

      await expect(voice.input().sendTurn('add a retry', { busy: false })).rejects.toThrow()
    })
  })
})

describe('PromptInput submission', () => {
  it('keeps submitted text until send succeeds', async () => {
    const send = deferredRoute()
    await renderPromptInput({ sendPrompt: send.respond })

    fireEvent.change(promptTextarea(), { target: { value: 'retry me' } })
    fireEvent.click(screen.getByTitle('Send'))

    expect(promptTextarea()).toHaveValue('retry me')

    await act(async () => {
      send.resolve(promptInboxBody('test-session'))
    })
  })

  it('clears submitted text after send success', async () => {
    await renderPromptInput()

    fireEvent.change(promptTextarea(), { target: { value: 'sent message' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
  })

  it('clears submitted text once the server confirms it is processing', async () => {
    const send = deferredRoute()
    const { rerenderWith } = await renderPromptInput({ sendPrompt: send.respond })

    fireEvent.change(promptTextarea(), { target: { value: 'do the thing' } })
    fireEvent.click(screen.getByTitle('Send'))
    expect(promptTextarea()).toHaveValue('do the thing')

    await rerenderWith({ isStreamingResponse: true })

    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
    await act(async () => {
      send.resolve(promptInboxBody('test-session'))
    })
  })

  it('allows queuing a follow-up while a non-queued send is pending', async () => {
    const send = deferredRoute()
    const { fetchFake, rerenderWith } = await renderPromptInput({ sendPrompt: send.respond })

    fireEvent.change(promptTextarea(), { target: { value: 'first message' } })
    fireEvent.click(screen.getByTitle('Send'))

    await rerenderWith({ isStreamingResponse: true })

    fireEvent.change(promptTextarea(), { target: { value: 'follow-up' } })
    const queueButton = screen.getByTitle('Queue message')
    expect(queueButton).not.toBeDisabled()

    fireEvent.click(queueButton)

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/prompt')).toHaveLength(2))
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
      text: 'follow-up',
      delivery: 'queue',
    })
    await act(async () => {
      send.resolve(promptInboxBody('test-session'))
    })
  })

  it('restores a failed prompt when the input is empty', async () => {
    await renderPromptInput()
    expect(promptTextarea()).toHaveValue('')

    act(() => {
      useSendErrorStore.getState().setError({
        sessionID: 'test-session',
        title: 'Error',
        message: 'Queued send failed',
        failedPrompt: 'queued message',
      })
    })

    await waitFor(() => expect(promptTextarea()).toHaveValue('queued message'))
  })

  it('clears the restored prompt when the send error resolves', async () => {
    await renderPromptInput()
    act(() => {
      useSendErrorStore.getState().setError({
        sessionID: 'test-session',
        title: 'Connection Failed',
        message: 'Could not connect.',
        failedPrompt: 'recovered prompt',
        kind: 'network',
      })
    })

    await waitFor(() => expect(promptTextarea()).toHaveValue('recovered prompt'))

    act(() => {
      useSendErrorStore.getState().clearError('test-session')
    })

    await waitFor(() => expect(promptTextarea()).toHaveValue(''))
  })

  it('keeps stop available while active with prompt content', async () => {
    await renderPromptInput({ isSessionActive: true })

    fireEvent.change(promptTextarea(), { target: { value: 'draft while active' } })

    expect(screen.getAllByTitle('Stop').length).toBeGreaterThan(0)
  })

  it('clears the draft store for the session after a successful send', async () => {
    await renderPromptInput({ sessionID: 'test-session' })

    fireEvent.change(promptTextarea(), { target: { value: 'stored draft' } })
    expect(useComposerDraftStore.getState().getDraft('test-session').prompt).toBe('stored draft')

    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(useComposerDraftStore.getState().getDraft('test-session').prompt).toBe(''))
  })
})
