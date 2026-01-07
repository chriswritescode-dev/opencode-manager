import { useEffect, useCallback, useState, useRef } from 'react'
import { X, Mic, Loader2, Volume2 } from 'lucide-react'
import { useTalkMode } from '@/hooks/useTalkMode'
import { TalkModeOrb } from './TalkModeOrb'
import { cn } from '@/lib/utils'

interface TalkModeOverlayProps {
  sessionID: string
}

interface CaptionEntry {
  id: number
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

export function TalkModeOverlay({ sessionID }: TalkModeOverlayProps) {
  const {
    state,
    error,
    userTranscript,
    liveTranscript,
    agentResponse,
    userSpeaking,
    sessionID: activeSessionID,
    stop
  } = useTalkMode()

  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const captionIdRef = useRef(0)
  const lastUserTranscriptRef = useRef<string | null>(null)
  const lastAgentResponseRef = useRef<string | null>(null)
  const captionsEndRef = useRef<HTMLDivElement>(null)

  const isActive = state !== 'off' && activeSessionID === sessionID

  useEffect(() => {
    if (userTranscript && userTranscript !== lastUserTranscriptRef.current) {
      lastUserTranscriptRef.current = userTranscript
      setCaptions(prev => [...prev, {
        id: ++captionIdRef.current,
        role: 'user',
        text: userTranscript,
        timestamp: Date.now()
      }])
    }
  }, [userTranscript])

  useEffect(() => {
    if (agentResponse && agentResponse !== lastAgentResponseRef.current) {
      lastAgentResponseRef.current = agentResponse
      setCaptions(prev => [...prev, {
        id: ++captionIdRef.current,
        role: 'assistant',
        text: agentResponse,
        timestamp: Date.now()
      }])
    }
  }, [agentResponse])

  useEffect(() => {
    captionsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [captions, liveTranscript])

  useEffect(() => {
    if (!isActive) {
      setCaptions([])
      lastUserTranscriptRef.current = null
      lastAgentResponseRef.current = null
    }
  }, [isActive])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isActive) {
      e.preventDefault()
      stop()
    }
  }, [isActive, stop])

  useEffect(() => {
    if (isActive) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActive, handleKeyDown])

  useEffect(() => {
    return () => {
      if (activeSessionID === sessionID) {
        stop()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionID, activeSessionID])

  if (!isActive) return null

  const getStatusText = () => {
    switch (state) {
      case 'initializing':
        return 'Starting...'
      case 'listening':
        return userSpeaking ? 'Listening...' : 'Speak now...'
      case 'thinking':
        return 'Thinking...'
      case 'speaking':
        return 'Speaking...'
      case 'error':
        return error || 'Error occurred'
      default:
        return ''
    }
  }

  const getStatusIcon = () => {
    switch (state) {
      case 'initializing':
      case 'thinking':
        return <Loader2 className="w-4 h-4 animate-spin" />
      case 'listening':
        return <Mic className={cn('w-4 h-4', userSpeaking && 'text-green-400 animate-pulse')} />
      case 'speaking':
        return <Volume2 className="w-4 h-4 text-purple-400 animate-pulse" />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col pointer-events-none">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto" onClick={stop} />
      
      {/* Close button */}
      <div className="absolute top-4 right-4 z-20 pointer-events-auto">
        <button
          onClick={stop}
          className="p-2 rounded-full bg-black/50 hover:bg-black/70 border border-white/20 shadow-lg transition-colors"
          title="Exit Talk Mode (Escape)"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Center orb with status */}
      <div className="flex-1 flex items-center justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-4">
          <TalkModeOrb state={state} userSpeaking={userSpeaking} />
          <div className="flex items-center gap-2 text-sm text-white/80 bg-black/30 px-4 py-2 rounded-full backdrop-blur-sm">
            {getStatusIcon()}
            <span>{getStatusText()}</span>
          </div>
        </div>
      </div>

      {/* Captions area at bottom */}
      <div className="relative z-10 w-full max-w-3xl mx-auto mb-8 px-4 pointer-events-auto">
        <div className="bg-black/70 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Caption history */}
          <div className="max-h-48 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-white/20">
            {captions.map((caption) => (
              <div
                key={caption.id}
                className={cn(
                  "flex gap-3 items-start animate-in fade-in slide-in-from-bottom-2 duration-300",
                  caption.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {caption.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center flex-shrink-0">
                    <Volume2 className="w-3 h-3 text-purple-400" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] px-4 py-2 rounded-2xl text-sm",
                    caption.role === 'user'
                      ? 'bg-blue-500/30 text-blue-100 rounded-br-sm'
                      : 'bg-purple-500/20 text-purple-100 rounded-bl-sm'
                  )}
                >
                  <span className="text-[10px] uppercase tracking-wider opacity-60 block mb-0.5">
                    {caption.role === 'user' ? 'You' : 'Assistant'}
                  </span>
                  {caption.text}
                </div>
                {caption.role === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-blue-500/30 flex items-center justify-center flex-shrink-0">
                    <Mic className="w-3 h-3 text-blue-400" />
                  </div>
                )}
              </div>
            ))}
            
            {/* Live transcript while listening */}
            {liveTranscript && state === 'listening' && (
              <div className="flex gap-3 items-start justify-end animate-in fade-in duration-200">
                <div className="max-w-[80%] px-4 py-2 rounded-2xl rounded-br-sm bg-green-500/20 border border-green-500/30 text-sm text-green-100">
                  <span className="text-[10px] uppercase tracking-wider opacity-60 block mb-0.5">
                    Listening...
                  </span>
                  <span className="opacity-90">{liveTranscript}</span>
                  <span className="inline-block w-1.5 h-4 bg-green-400 ml-1 animate-pulse" />
                </div>
                <div className="w-6 h-6 rounded-full bg-green-500/30 flex items-center justify-center flex-shrink-0 animate-pulse">
                  <Mic className="w-3 h-3 text-green-400" />
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {state === 'thinking' && (
              <div className="flex gap-3 items-start justify-start animate-in fade-in duration-200">
                <div className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center flex-shrink-0">
                  <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />
                </div>
                <div className="px-4 py-2 rounded-2xl rounded-bl-sm bg-purple-500/10 border border-purple-500/20 text-sm text-purple-200">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}

            <div ref={captionsEndRef} />
          </div>

          {/* Error message */}
          {error && (
            <div className="px-4 py-2 bg-red-500/20 border-t border-red-500/30 text-red-200 text-xs">
              {error}
            </div>
          )}

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-white/10 text-[11px] text-white/40 text-center">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[10px]">Esc</kbd> to exit Talk Mode
          </div>
        </div>
      </div>
    </div>
  )
}
