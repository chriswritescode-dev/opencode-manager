import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { TalkModeState } from '@/contexts/talk-mode-context'

interface TalkModeOrbProps {
  state: TalkModeState
  userSpeaking: boolean
  className?: string
}

export const TalkModeOrb = memo(function TalkModeOrb({ state, userSpeaking, className }: TalkModeOrbProps) {
  const getOrbColors = () => {
    switch (state) {
      case 'initializing':
        return 'from-gray-400 to-gray-600'
      case 'listening':
        return userSpeaking 
          ? 'from-green-400 to-emerald-600' 
          : 'from-cyan-400 to-blue-600'
      case 'thinking':
        return 'from-yellow-400 to-orange-500'
      case 'speaking':
        return 'from-purple-400 to-violet-600'
      case 'error':
        return 'from-red-400 to-red-600'
      default:
        return 'from-gray-400 to-gray-600'
    }
  }

  const getAnimation = () => {
    switch (state) {
      case 'initializing':
        return 'animate-pulse'
      case 'listening':
        return userSpeaking ? 'animate-talk-mode-active' : 'animate-talk-mode-idle'
      case 'thinking':
        return 'animate-spin-slow'
      case 'speaking':
        return 'animate-talk-mode-speaking'
      case 'error':
        return ''
      default:
        return ''
    }
  }

  const getGlowColor = () => {
    switch (state) {
      case 'listening':
        return userSpeaking ? 'shadow-green-500/50' : 'shadow-cyan-500/50'
      case 'thinking':
        return 'shadow-yellow-500/50'
      case 'speaking':
        return 'shadow-purple-500/50'
      case 'error':
        return 'shadow-red-500/50'
      default:
        return 'shadow-gray-500/30'
    }
  }

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'w-24 h-24 md:w-32 md:h-32 rounded-full',
          'bg-gradient-to-br',
          getOrbColors(),
          getAnimation(),
          'shadow-2xl',
          getGlowColor(),
          'transition-all duration-300'
        )}
      >
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white/20 to-transparent" />
        <div className="absolute inset-0 rounded-full bg-gradient-to-t from-black/20 to-transparent" />
      </div>
      
      {(state === 'listening' || state === 'speaking') && (
        <>
          <div
            className={cn(
              'absolute inset-0 rounded-full',
              'bg-gradient-to-br',
              getOrbColors(),
              'opacity-30',
              'animate-ping-slow'
            )}
          />
          <div
            className={cn(
              'absolute -inset-2 rounded-full',
              'bg-gradient-to-br',
              getOrbColors(),
              'opacity-20',
              'animate-ping-slower'
            )}
          />
        </>
      )}
    </div>
  )
})
