import { useCallback } from 'react'
import { Headphones, HeadphoneOff, Loader2 } from 'lucide-react'
import { useTalkMode } from '@/hooks/useTalkMode'
import { cn } from '@/lib/utils'

interface TalkModeButtonProps {
  sessionID: string
  opcodeUrl: string
  directory?: string
  disabled?: boolean
  className?: string
}

export function TalkModeButton({ 
  sessionID, 
  opcodeUrl, 
  directory, 
  disabled, 
  className 
}: TalkModeButtonProps) {
  const { 
    state, 
    sessionID: activeSessionID, 
    start, 
    stop, 
    isEnabled 
  } = useTalkMode()

  const isActiveForThisSession = state !== 'off' && activeSessionID === sessionID
  const isActiveForOtherSession = state !== 'off' && activeSessionID !== sessionID
  const isInitializing = state === 'initializing'

  const handleClick = useCallback(async () => {
    if (isActiveForThisSession) {
      stop()
    } else if (!isActiveForOtherSession) {
      await start(sessionID, opcodeUrl, directory)
    }
  }, [isActiveForThisSession, isActiveForOtherSession, start, stop, sessionID, opcodeUrl, directory])

  if (!isEnabled) {
    return null
  }

  const getButtonStyle = () => {
    if (isActiveForThisSession) {
      return 'bg-gradient-to-br from-purple-500 to-violet-600 hover:from-purple-400 hover:to-violet-500 text-white border-purple-400 shadow-lg shadow-purple-500/30'
    }
    if (isActiveForOtherSession) {
      return 'bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed'
    }
    return 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground border-border'
  }

  const getTitle = () => {
    if (isActiveForThisSession) return 'Exit Talk Mode'
    if (isActiveForOtherSession) return 'Talk Mode active in another session'
    return 'Start Talk Mode'
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isInitializing || isActiveForOtherSession}
      className={cn(
        'p-2 rounded-lg transition-all duration-200 active:scale-95 border',
        getButtonStyle(),
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      title={getTitle()}
    >
      {isInitializing ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : isActiveForThisSession ? (
        <HeadphoneOff className="w-5 h-5" />
      ) : (
        <Headphones className="w-5 h-5" />
      )}
    </button>
  )
}
