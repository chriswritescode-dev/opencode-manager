import { useContext } from 'react'
import { STTContext, type STTContextValue } from '@/contexts/stt-context'

export function useSTT(): STTContextValue {
  const context = useContext(STTContext)
  
  if (!context) {
    throw new Error('useSTT must be used within an STTProvider')
  }
  
  return context
}
