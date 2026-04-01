import { useEffect } from 'react'
import { showToast } from '@/lib/toast'
import { onServiceWorkerUpdate, offServiceWorkerUpdate } from '@/lib/serviceWorker'

export function PwaUpdatePrompt() {
  useEffect(() => {
    onServiceWorkerUpdate(() => {
      showToast.info('New build deployed', {
        description: 'Refresh to load the latest changes.',
        action: {
          label: 'Refresh',
          onClick: () => window.location.reload(),
        },
        duration: Infinity,
      })
    })
    return () => offServiceWorkerUpdate()
  }, [])

  return null
}
