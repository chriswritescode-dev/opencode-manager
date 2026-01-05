import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useStreamingVAD } from '@/hooks/useStreamingVAD'
import { TalkModeContext, type TalkModeState } from './talk-mode-context'
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
  const { speak, stop: stopTTS } = useTTS()

  const [state, setState] = useState<TalkModeState>('off')
  const [error, setError] = useState<string | null>(null)
  const [userTranscript, setUserTranscript] = useState<string | null>(null)
  const [liveTranscript, setLiveTranscript] = useState<string>('')
  const [agentResponse, setAgentResponse] = useState<string | null>(null)
  const [sessionID, setSessionID] = useState<string | null>(null)

  const opcodeUrlRef = useRef<string | null>(null)
  const directoryRef = useRef<string | undefined>(undefined)
  const isActiveRef = useRef(false)
  const stateRef = useRef<TalkModeState>('off')
  const lastProcessedMessageIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userTranscriptRef = useRef<string | null>(null)
  const agentResponseRef = useRef<string | null>(null)
  const sessionIDRef = useRef<string | null>(null)

  const talkModeConfig = preferences?.talkMode
  const sttConfig = preferences?.stt
  const isEnabled = !!(talkModeConfig?.enabled && sttConfig?.enabled)

  const silenceTimeoutMs = talkModeConfig?.silenceThresholdMs ?? 1500

  const updateState = useCallback((newState: TalkModeState) => {
    stateRef.current = newState
    setState(newState)
  }, [])

  const sendToOpenCode = useCallback(async (transcript: string) => {
    if (!isActiveRef.current) return

    const opcodeUrl = opcodeUrlRef.current
    const directory = directoryRef.current
    const currentSessionID = sessionIDRef.current

    if (!opcodeUrl || !currentSessionID || !transcript) {
      updateState('listening')
      return
    }

    updateState('thinking')
    setUserTranscript(transcript)
    userTranscriptRef.current = transcript
    setLiveTranscript('')

    try {
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
      const message = err instanceof Error ? err.message : 'Failed to send message'
      setError(message)
      updateState('listening')
      setTimeout(() => setError(null), 3000)
    }
  }, [updateState])

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
        const messagesResponse = await fetch(`${opcodeUrl}/session/${currentSessionID}/message`, {
          headers: directory ? { 'x-opencode-dir': directory } : {}
        })
        if (!messagesResponse.ok) return
        
        const messages = await messagesResponse.json()
        
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
  }, [speak, updateState])

  const handleTranscriptUpdate = useCallback((transcript: string, isFinal: boolean) => {
    if (!isActiveRef.current) return
    
    setLiveTranscript(transcript)
    
    if (isFinal) {
      // Will be handled by onSpeechEnd
    }
  }, [])

  const handleSpeechEnd = useCallback((fullTranscript: string) => {
    if (!isActiveRef.current || stateRef.current !== 'listening') return
    
    if (fullTranscript && fullTranscript.trim()) {
      sendToOpenCode(fullTranscript.trim())
    }
  }, [sendToOpenCode])

  const streamingVAD = useStreamingVAD({
    chunkIntervalMs: 2500,
    silenceTimeoutMs,
    onTranscriptUpdate: handleTranscriptUpdate,
    onSpeechEnd: handleSpeechEnd,
    sttConfig: {
      model: sttConfig?.model,
      language: sttConfig?.language
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
    setLiveTranscript('')
    setAgentResponse(null)
    agentResponseRef.current = null

    try {
      await streamingVAD.start()
      updateState('listening')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Talk Mode'
      setError(message)
      updateState('error')
      isActiveRef.current = false
    }
  }, [isEnabled, streamingVAD, updateState])

  const stop = useCallback(() => {
    isActiveRef.current = false

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    streamingVAD.stop()
    stopTTS()

    updateState('off')
    setSessionID(null)
    sessionIDRef.current = null
    setError(null)
    setUserTranscript(null)
    userTranscriptRef.current = null
    setLiveTranscript('')
    setAgentResponse(null)
    agentResponseRef.current = null
    opcodeUrlRef.current = null
    directoryRef.current = undefined
    lastProcessedMessageIdRef.current = null
  }, [streamingVAD, stopTTS, updateState])

  useEffect(() => {
    return () => {
      isActiveRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (streamingVAD.error) {
      setError(streamingVAD.error)
    }
  }, [streamingVAD.error])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const testApi = {
        injectTranscript: (transcript: string) => {
          if (stateRef.current === 'listening' && isActiveRef.current) {
            handleSpeechEnd(transcript)
            return true
          }
          return false
        },
        getState: () => ({
          state: stateRef.current,
          isActive: isActiveRef.current,
          sessionID: sessionIDRef.current,
          userTranscript: userTranscriptRef.current,
          agentResponse: agentResponseRef.current,
          liveTranscript: streamingVAD.currentTranscript
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
  }, [handleSpeechEnd, updateState, streamingVAD.currentTranscript])

  const value = {
    state,
    error,
    userTranscript,
    liveTranscript,
    agentResponse,
    userSpeaking: streamingVAD.isListening && streamingVAD.isProcessing,
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
