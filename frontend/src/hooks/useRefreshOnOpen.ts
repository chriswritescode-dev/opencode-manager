import { useEffect, useRef } from 'react'

export function useRefreshOnOpen(isOpen: boolean, refresh: () => void) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!isOpen) return
    refreshRef.current()
  }, [isOpen])
}
