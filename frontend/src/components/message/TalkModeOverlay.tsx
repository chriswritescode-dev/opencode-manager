import { useEffect, useCallback } from 'react'
import { X, Mic, Loader2, Volume2 } from 'lucide-react'
import { useTalkMode } from '@/hooks/useTalkMode'
import { TalkModeOrb } from './TalkModeOrb'
import { cn } from '@/lib/utils'

interface TalkModeOverlayProps {
  sessionID: string
}

export function TalkModeOverlay({ sessionID }: TalkModeOverlayProps) {
  const {
    state,
    error,
    userTranscript,
    agentResponse,
    userSpeaking,
    sessionID: activeSessionID,
    stop
  } = useTalkMode()

  const isActive = state !== 'off' && activeSessionID === sessionID

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
  }, [sessionID, activeSessionID, stop])

  if (!isActive) return null

  const getStatusText = () => {
    switch (state) {
      case 'initializing':
        return 'Starting...'
      case 'listening':
        return userSpeaking ? 'Listening...' : 'Listening...'
      case 'thinking':
        return 'Processing...'
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
        return <Mic className={cn('w-4 h-4', userSpeaking && 'text-green-500')} />
      case 'speaking':
        return <Volume2 className="w-4 h-4 animate-pulse" />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto" onClick={stop} />
      
      <div className="relative z-10 flex flex-col items-center gap-6 p-8 max-w-lg w-full mx-4 pointer-events-auto">
        <div className="absolute top-0 right-0 md:top-4 md:right-4">
          <button
            onClick={stop}
            className="p-2 rounded-full bg-card/80 hover:bg-card border border-border shadow-lg transition-colors"
            title="Exit Talk Mode (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4">
          <TalkModeOrb state={state} userSpeaking={userSpeaking} />
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {getStatusIcon()}
            <span>{getStatusText()}</span>
          </div>
        </div>

        <div className="w-full space-y-3">
          {userTranscript && (
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 backdrop-blur-md">
              <div className="text-xs text-blue-400 mb-1 font-medium">You said:</div>
              <div className="text-sm text-foreground">{userTranscript}</div>
            </div>
          )}

          {agentResponse && (
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 backdrop-blur-md max-h-48 overflow-y-auto">
              <div className="text-xs text-purple-400 mb-1 font-medium">Agent:</div>
              <div className="text-sm text-foreground whitespace-pre-wrap">{agentResponse}</div>
            </div>
          )}

          {error && state !== 'error' && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 backdrop-blur-md">
              <div className="text-xs text-red-400">{error}</div>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center">
          Press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-xs">Esc</kbd> to exit
        </div>
      </div>
    </div>
  )
}
