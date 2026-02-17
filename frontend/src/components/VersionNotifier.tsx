import { useEffect, useRef } from 'react'
import { showToast } from '@/lib/toast'
import { useVersionCheck } from '@/hooks/useVersionCheck'

export function VersionNotifier() {
  const { data, isSuccess } = useVersionCheck()
  const hasNotifiedRef = useRef(false)

  useEffect(() => {
    if (!isSuccess || !data || hasNotifiedRef.current) return

    if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
      hasNotifiedRef.current = true
      showToast.info(`OpenCode Manager v${data.latestVersion} is available`, {
        description: 'A new version is ready to install.',
        action: {
          label: 'View Release',
          onClick: () => window.open(data.releaseUrl ?? '', '_blank'),
        },
        duration: 10000,
      })
    }
  }, [isSuccess, data])

  return null
}
