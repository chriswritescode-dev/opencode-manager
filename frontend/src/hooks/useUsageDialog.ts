import { useCallback } from 'react'
import { useUrlParams } from './useUrlParams'

interface UseUsageDialogReturn {
  isOpen: boolean
  open: (history?: 'push' | 'replace') => void
  close: () => void
}

export function useUsageDialog(): UseUsageDialogReturn {
  const { searchParams, updateParams, closePushedParams } = useUrlParams()

  const isOpen = searchParams.get('usage') === 'open'

  const open = useCallback((history: 'push' | 'replace' = 'push') => {
    updateParams((p) => {
      p.set('usage', 'open')
      p.delete('mobileTab')
    }, history)
  }, [updateParams])

  const close = useCallback(() => {
    closePushedParams((p) => p.delete('usage'))
  }, [closePushedParams])

  return { isOpen, open, close }
}
