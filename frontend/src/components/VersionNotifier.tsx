import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import { showToast } from '@/lib/toast'
import { useVersionCheck } from '@/hooks/useVersionCheck'

export function VersionNotifier() {
  const { t } = useTranslation()
  const { data, isSuccess } = useVersionCheck()
  const hasNotifiedRef = useRef(false)

  useEffect(() => {
    if (!isSuccess || !data || hasNotifiedRef.current) return

    if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
      hasNotifiedRef.current = true
      showToast.info(t('versionNotifier.newVersionInfo', { version: data.latestVersion }), {
        description: t('versionNotifier.readyToInstall'),
        action: {
          label: t('versionNotifier.viewRelease'),
          onClick: () => window.open(data.releaseUrl ?? '', '_blank'),
        },
        duration: 10000,
      })
    }
  }, [isSuccess, data, t])

  return null
}
