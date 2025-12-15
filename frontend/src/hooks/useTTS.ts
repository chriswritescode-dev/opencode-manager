import { useContext } from 'react'
import { TTSContext, type TTSContextValue, type TTSState } from '@/contexts/tts-context'

export type { TTSState }

export function useTTS(): TTSContextValue {
  const context = useContext(TTSContext)
  if (!context) {
    throw new Error('useTTS must be used within a TTSProvider')
  }
  return context
}
