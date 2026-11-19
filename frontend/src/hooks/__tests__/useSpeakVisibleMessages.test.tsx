import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RefObject } from 'react'
import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import { renderHookWithProviders } from '@/test/render'
import { installAudio, installObjectUrl } from '@/test/browserFakes'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { DEFAULT_TTS_CONFIG } from '@/api/types/settings'
import { useTTS } from '@/hooks/useTTS'
import { useSpeakVisibleMessages } from '../useSpeakVisibleMessages'

const SYNTHESIZE_ROUTE = '/api/tts/synthesize'

const enabledTtsSettings: FetchRoute = {
  method: 'GET',
  path: '/api/settings',
  respond: () => ({
    json: makeSettingsResponse({
      preferences: makeUserPreferences({
        tts: { ...DEFAULT_TTS_CONFIG, enabled: true, provider: 'external', apiKey: 'test-key' },
      }),
    }),
  }),
}

function audioReply(): FetchRouteResult {
  return {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
    blob: new Blob(['audio'], { type: 'audio/mpeg' }),
  }
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function buildContainer(messageIds: string[]): HTMLDivElement {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => rect(0, 100)
  for (const messageId of messageIds) {
    const element = document.createElement('div')
    element.dataset.messageId = messageId
    element.getBoundingClientRect = () => rect(10, 30)
    container.appendChild(element)
  }
  return container
}

function assistantMessage(id: string, text: string): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    agent: 'test-agent',
    model: { providerID: 'test-provider', id: 'test-model' },
    content: [{ type: 'text', text }],
    time: { created: 1, completed: 2 },
  }
}

function renderSpeak(
  messages: SessionMessageInfo[],
  messageIds: string[],
  routes: FetchRoute[],
) {
  const containerRef: RefObject<HTMLElement | null> = { current: buildContainer(messageIds) }
  const rendered = renderHookWithProviders(
    () => {
      const tts = useTTS()
      return { speakVisible: useSpeakVisibleMessages(containerRef, messages, 0), tts }
    },
    { theme: false, tts: true, fetchRoutes: routes },
  )

  const speakVisible = async () => {
    await act(async () => {
      rendered.result.current.speakVisible()
      await Promise.resolve()
    })
  }

  return { ...rendered, speakVisible }
}

describe('useSpeakVisibleMessages', () => {
  it('speaks the visible assistant texts joined by a blank line', async () => {
    const messages = [assistantMessage('a1', 'hello world'), assistantMessage('a2', 'second message')]
    const { result, fetchFake, speakVisible } = renderSpeak(messages, ['a1', 'a2'], [
      enabledTtsSettings,
      { method: 'POST', path: SYNTHESIZE_ROUTE, respond: audioReply },
    ])

    await waitFor(() => expect(result.current.tts.isEnabled).toBe(true))
    await speakVisible()

    await waitFor(() => expect(fetchFake.lastRequest('POST', SYNTHESIZE_ROUTE)).toBeDefined())
    expect(fetchFake.lastRequest('POST', SYNTHESIZE_ROUTE)?.body).toEqual({
      text: 'hello world\nsecond message',
    })
  })

  it('stops playback instead of restarting it while speaking', async () => {
    const audio = installAudio()
    installObjectUrl()
    const messages = [assistantMessage('a1', 'hello world')]
    const { result, fetchFake, speakVisible } = renderSpeak(messages, ['a1'], [
      enabledTtsSettings,
      { method: 'POST', path: SYNTHESIZE_ROUTE, respond: audioReply },
    ])

    await waitFor(() => expect(result.current.tts.isEnabled).toBe(true))
    await speakVisible()
    await waitFor(() => expect(result.current.tts.isPlaying).toBe(true))

    await speakVisible()

    expect(result.current.tts.isPlaying).toBe(false)
    expect(audio.pause).toHaveBeenCalled()
    expect(fetchFake.findRequests('POST', SYNTHESIZE_ROUTE)).toHaveLength(1)
  })

  it('does nothing when TTS is disabled', async () => {
    const messages = [assistantMessage('a1', 'hello world')]
    const { fetchFake, speakVisible, result } = renderSpeak(messages, ['a1'], [])

    await waitFor(() => expect(result.current.tts.isEnabled).toBe(false))
    await speakVisible()

    expect(fetchFake.findRequests('POST', SYNTHESIZE_ROUTE)).toHaveLength(0)
  })

  it('shows one error toast after shortcut-started playback fails', async () => {
    const messages = [assistantMessage('a1', 'hello world')]
    const { result, fetchFake, speakVisible } = renderSpeak(messages, ['a1'], [
      enabledTtsSettings,
      { method: 'POST', path: SYNTHESIZE_ROUTE, respond: () => ({ status: 500, json: { error: 'Service down' } }) },
    ])

    await waitFor(() => expect(result.current.tts.isEnabled).toBe(true))
    await speakVisible()

    expect(await screen.findByText('Service down')).toBeInTheDocument()

    await act(async () => {
      void result.current.tts.speak('another attempt')
      await Promise.resolve()
    })
    await waitFor(() => expect(fetchFake.findRequests('POST', SYNTHESIZE_ROUTE)).toHaveLength(2))

    expect(screen.getAllByText('Service down')).toHaveLength(1)
  })

  it('does not toast when playback returns to idle before failing', async () => {
    const messages = [assistantMessage('a1', 'hello world')]
    let failNext = false
    const { result, fetchFake, speakVisible } = renderSpeak(messages, ['a1'], [
      enabledTtsSettings,
      {
        method: 'POST',
        path: SYNTHESIZE_ROUTE,
        respond: () => (failNext ? { status: 500, json: { error: 'Service down' } } : audioReply()),
      },
    ])

    await waitFor(() => expect(result.current.tts.isEnabled).toBe(true))
    await speakVisible()
    await waitFor(() => expect(result.current.tts.isPlaying).toBe(true))

    act(() => {
      result.current.tts.stop()
    })
    await waitFor(() => expect(result.current.tts.state).toBe('idle'))

    failNext = true
    await act(async () => {
      void result.current.tts.speak('later failure')
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.tts.state).toBe('error'))

    expect(fetchFake.findRequests('POST', SYNTHESIZE_ROUTE)).toHaveLength(2)
    expect(screen.queryByText('Service down')).toBeNull()
  })
})
