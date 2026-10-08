import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { onServiceWorkerUpdate, offServiceWorkerUpdate } from '@/lib/serviceWorker'

export function PwaUpdatePrompt() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    onServiceWorkerUpdate(() => setVisible(true))
    return () => offServiceWorkerUpdate()
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full shrink-0 bg-primary pt-safe text-primary-foreground"
    >
      <div className="flex items-center justify-center gap-3 px-4 py-2">
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">
          A new version of OpenCode Manager is available.
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    </div>
  )
}
