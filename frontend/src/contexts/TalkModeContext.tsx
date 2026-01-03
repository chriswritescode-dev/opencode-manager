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
  const pendingAudioRef = useRef<Float32Array | null>(null)
  const lastProcessedMessageIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const talkModeConfig = preferences?.talkMode
  const sttConfig = preferences?.stt
  const isEnabled = !!(talkModeConfig?.enabled && sttConfig?.enabled)

  const silenceThresholdMs = talkModeConfig?.silenceThresholdMs ?? 800
  const minSpeechMs = talkModeConfig?.minSpeechMs ?? 400
  const autoInterrupt = talkModeConfig?.autoInterrupt ?? true

  const processAudio = useCallback(async (audio: Float32Array) => {
    if (!isActiveRef.current || state === 'off') return

    setState('thinking')
    setError(null)

    try {
      const wavBlob = float32ToWav(audio, 16000)
      const base64Audio = await blobToBase64(wavBlob)

      const result = await sttApi.transcribeBase64(base64Audio, 'wav', {
        model: sttConfig?.model,
        language: sttConfig?.language
      })

      if (!isActiveRef.current) return

      const transcript = result.text?.trim()
      if (!transcript) {
        setState('listening')
        return
      }

      setUserTranscript(transcript)

      const opcodeUrl = opcodeUrlRef.current
      const directory = directoryRef.current
      const currentSessionID = sessionID

      if (!opcodeUrl || !currentSessionID) {
        setState('listening')
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

      startPollingForResponse()

    } catch (err) {
      if (!isActiveRef.current) return
      const message = err instanceof Error ? err.message : 'Failed to process audio'
      setError(message)
      setState('listening')
      setTimeout(() => setError(null), 3000)
    }
  }, [state, sessionID, sttConfig?.model, sttConfig?.language])

  const startPollingForResponse = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    const opcodeUrl = opcodeUrlRef.current
    const directory = directoryRef.current
    const currentSessionID = sessionID

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
            setState('speaking')
            await speak(textContent)

            if (isActiveRef.current) {
              setAgentResponse(null)
              setState('listening')
            }
          } else {
            setState('listening')
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 500)
  }, [sessionID, queryClient, speak])

  const vad = useMicVAD({
    startOnLoad: false,
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    redemptionFrames: Math.ceil(silenceThresholdMs / 96),
    minSpeechFrames: Math.ceil(minSpeechMs / 96),
    preSpeechPadFrames: 3,
    baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/',
    onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
    onSpeechStart: () => {
      if (autoInterrupt && state === 'speaking' && isPlaying) {
        stopTTS()
        setState('listening')
        setAgentResponse(null)
      }
    },
    onSpeechEnd: (audio) => {
      if (isActiveRef.current && state === 'listening') {
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
    opcodeUrlRef.current = opcodeUrl
    directoryRef.current = directory
    isActiveRef.current = true
    lastProcessedMessageIdRef.current = null

    setState('initializing')
    setError(null)
    setUserTranscript(null)
    setAgentResponse(null)

    try {
      vad.start()
      setState('listening')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Talk Mode'
      setError(message)
      setState('error')
      isActiveRef.current = false
    }
  }, [isEnabled, vad])

  const stop = useCallback(() => {
    isActiveRef.current = false

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    vad.pause()
    stopTTS()

    setState('off')
    setSessionID(null)
    setError(null)
    setUserTranscript(null)
    setAgentResponse(null)
    opcodeUrlRef.current = null
    directoryRef.current = undefined
    lastProcessedMessageIdRef.current = null
  }, [vad, stopTTS])

  useEffect(() => {
    return () => {
      isActiveRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

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
