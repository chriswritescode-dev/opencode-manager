import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useMicVAD } from '@ricky0123/vad-react'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { sttApi } from '@/api/stt'
import { TalkModeContext, type TalkModeState } from './talk-mode-context'
import { float32ToWav, blobToBase64 } from '@/lib/audioUtils'
import { useQueryClient } from '@tanstack/react-query'
import type { MessageWithParts } from '@/api/types'

export { TalkModeContext } from './talk-mode-context'
export type { TalkModeState, TalkModeContextValue } from './talk-mode-context'

interface TalkModeProviderProps {
  children: ReactNode
}

function getMessageTextContent(msg: MessageWithParts): string {
  return msg.parts
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('\n\n')
    .trim()
}

export function TalkModeProvider({ children }: TalkModeProviderProps) {
  const { preferences } = useSettings()
  const { speak, stop: stopTTS, isPlaying } = useTTS()
  const queryClient = useQueryClient()

  const [state, setState] = useState<TalkModeState>('off')
  const [error, setError] = useState<string | null>(null)
  const [userTranscript, setUserTranscript] = useState<string | null>(null)
  const [agentResponse, setAgentResponse] = useState<string | null>(null)
  const [sessionID, setSessionID] = useState<string | null>(null)

  const opcodeUrlRef = useRef<string | null>(null)
  const directoryRef = useRef<string | undefined>(undefined)
  const isActiveRef = useRef(false)
  const stateRef = useRef<TalkModeState>('off')
  const pendingAudioRef = useRef<Float32Array | null>(null)
  const lastProcessedMessageIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startPollingRef = useRef<(() => void) | null>(null)
  const userTranscriptRef = useRef<string | null>(null)
  const agentResponseRef = useRef<string | null>(null)
  const sessionIDRef = useRef<string | null>(null)

  const talkModeConfig = preferences?.talkMode
  const sttConfig = preferences?.stt
  const isEnabled = !!(talkModeConfig?.enabled && sttConfig?.enabled)

  const silenceThresholdMs = talkModeConfig?.silenceThresholdMs ?? 800
  const minSpeechMs = talkModeConfig?.minSpeechMs ?? 400
  const autoInterrupt = talkModeConfig?.autoInterrupt ?? true

  const updateState = useCallback((newState: TalkModeState) => {
    stateRef.current = newState
    setState(newState)
  }, [])

  const processAudio = useCallback(async (audio: Float32Array) => {
    console.log('[TalkMode] processAudio called, length:', audio.length, 'state:', stateRef.current, 'active:', isActiveRef.current)
    if (!isActiveRef.current || stateRef.current === 'off') {
      console.log('[TalkMode] processAudio skipped - inactive or off')
      return
    }

    updateState('thinking')
    setError(null)

    try {
      console.log('[TalkMode] Converting audio to WAV...')
      const wavBlob = float32ToWav(audio, 16000)
      const base64Audio = await blobToBase64(wavBlob)
      console.log('[TalkMode] Sending to STT, base64 length:', base64Audio.length)

      const result = await sttApi.transcribeBase64(base64Audio, 'wav', {
        model: sttConfig?.model,
        language: sttConfig?.language
      })
      console.log('[TalkMode] STT result:', result)

      if (!isActiveRef.current) return

      const transcript = result.text?.trim()
      if (!transcript) {
        updateState('listening')
        return
      }

      setUserTranscript(transcript)
      userTranscriptRef.current = transcript

      const opcodeUrl = opcodeUrlRef.current
      const directory = directoryRef.current
      const currentSessionID = sessionIDRef.current

      if (!opcodeUrl || !currentSessionID) {
        console.log('[TalkMode] No opcodeUrl or sessionID, returning to listening')
        updateState('listening')
        return
      }

      const response = await fetch(`${opcodeUrl}/session/${currentSessionID}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(directory ? { 'x-opencode-dir': directory } : {})
        },
        body: JSON.stringify({
          parts: [{ type: 'text', text: transcript }]
        })
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      startPollingRef.current?.()

    } catch (err) {
      console.error('[TalkMode] processAudio error:', err)
      if (!isActiveRef.current) return
      const message = err instanceof Error ? err.message : 'Failed to process audio'
      setError(message)
      updateState('listening')
      setTimeout(() => setError(null), 3000)
    }
  }, [sttConfig?.model, sttConfig?.language, updateState])

  const startPollingForResponse = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    const opcodeUrl = opcodeUrlRef.current
    const directory = directoryRef.current
    const currentSessionID = sessionIDRef.current

    if (!opcodeUrl || !currentSessionID) return

    pollIntervalRef.current = setInterval(async () => {
      if (!isActiveRef.current) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        return
      }

      try {
        const messagesKey = ['opencode', 'messages', opcodeUrl, currentSessionID, directory]
        const messages = queryClient.getQueryData<MessageWithParts[]>(messagesKey)

        if (!messages || messages.length === 0) return

        const lastMessage = messages[messages.length - 1]

        if (lastMessage.info.role !== 'assistant') return

        const isComplete = 'completed' in lastMessage.info.time && lastMessage.info.time.completed

        if (isComplete && lastMessage.info.id !== lastProcessedMessageIdRef.current) {
          lastProcessedMessageIdRef.current = lastMessage.info.id

          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }

          const textContent = getMessageTextContent(lastMessage)
          if (textContent && isActiveRef.current) {
            setAgentResponse(textContent)
            agentResponseRef.current = textContent
            updateState('speaking')
            await speak(textContent)

            if (isActiveRef.current) {
              setAgentResponse(null)
              agentResponseRef.current = null
              updateState('listening')
            }
          } else {
            updateState('listening')
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 500)
  }, [queryClient, speak, updateState])

  startPollingRef.current = startPollingForResponse

  const vad = useMicVAD({
    startOnLoad: false,
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    redemptionFrames: Math.ceil(silenceThresholdMs / 96),
    minSpeechFrames: Math.ceil(minSpeechMs / 96),
    preSpeechPadFrames: 3,
    baseAssetPath: '/vad/',
    onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/',
    onSpeechStart: () => {
      if (autoInterrupt && stateRef.current === 'speaking' && isPlaying) {
        stopTTS()
        updateState('listening')
        setAgentResponse(null)
        agentResponseRef.current = null
      }
    },
    onSpeechEnd: (audio) => {
      if (isActiveRef.current && stateRef.current === 'listening') {
        pendingAudioRef.current = audio
        processAudio(audio)
      }
    },
    onVADMisfire: () => {
      // Ignored - too short
    }
  })

  const start = useCallback(async (newSessionID: string, opcodeUrl: string, directory?: string) => {
    if (!isEnabled) {
      setError('Talk Mode is not enabled. Enable it in Settings.')
      return
    }

    setSessionID(newSessionID)
    sessionIDRef.current = newSessionID
    opcodeUrlRef.current = opcodeUrl
    directoryRef.current = directory
    isActiveRef.current = true
    lastProcessedMessageIdRef.current = null

    updateState('initializing')
    setError(null)
    setUserTranscript(null)
    userTranscriptRef.current = null
    setAgentResponse(null)
    agentResponseRef.current = null

    try {
      vad.start()
      updateState('listening')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Talk Mode'
      setError(message)
      updateState('error')
      isActiveRef.current = false
    }
  }, [isEnabled, vad, updateState])

  const stop = useCallback(() => {
    isActiveRef.current = false

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    vad.pause()
    stopTTS()

    updateState('off')
    setSessionID(null)
    sessionIDRef.current = null
    setError(null)
    setUserTranscript(null)
    userTranscriptRef.current = null
    setAgentResponse(null)
    agentResponseRef.current = null
    opcodeUrlRef.current = null
    directoryRef.current = undefined
    lastProcessedMessageIdRef.current = null
  }, [vad, stopTTS, updateState])

  useEffect(() => {
    return () => {
      isActiveRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const testApi = {
        injectAudio: (audio: Float32Array) => {
          if (stateRef.current === 'listening' && isActiveRef.current) {
            console.log('[TalkMode Test] Injecting audio, length:', audio.length)
            processAudio(audio)
            return true
          }
          console.log('[TalkMode Test] Cannot inject - state:', stateRef.current, 'active:', isActiveRef.current)
          return false
        },
        getState: () => ({
          state: stateRef.current,
          isActive: isActiveRef.current,
          sessionID: sessionIDRef.current,
          userTranscript: userTranscriptRef.current,
          agentResponse: agentResponseRef.current
        }),
        forceListening: () => {
          if (isActiveRef.current) {
            updateState('listening')
            return true
          }
          return false
        }
      }
      ;(window as Window & typeof globalThis & { __TALK_MODE_TEST__?: typeof testApi }).__TALK_MODE_TEST__ = testApi
    }
  }, [processAudio, updateState])

  const value = {
    state,
    error,
    userTranscript,
    agentResponse,
    userSpeaking: vad.userSpeaking,
    sessionID,
    start,
    stop,
    isEnabled
  }

  return (
    <TalkModeContext.Provider value={value}>
      {children}
    </TalkModeContext.Provider>
  )
}
