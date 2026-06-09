import { useEffect, useRef } from 'react'
import { touchRepoActivity } from '@/api/repos'

export function useRepoActivity(repoId: number, isReady: boolean): void {
  const hasLoggedRef = useRef(false)

  useEffect(() => {
    if (!isReady || hasLoggedRef.current || repoId == null) {
      return
    }

    hasLoggedRef.current = true

    touchRepoActivity(repoId).catch(() => {
      // Silent failure - activity tracking must not block navigation
    })
  }, [repoId, isReady])
}
