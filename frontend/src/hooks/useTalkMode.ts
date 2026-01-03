import { useContext } from 'react'
import { TalkModeContext, type TalkModeContextValue } from '@/contexts/talk-mode-context'

export function useTalkMode(): TalkModeContextValue {
  const context = useContext(TalkModeContext)
  if (!context) {
    throw new Error('useTalkMode must be used within a TalkModeProvider')
  }
  return context
}
