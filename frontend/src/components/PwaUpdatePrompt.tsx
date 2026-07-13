import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { showToast } from '@/lib/toast'
import { onServiceWorkerUpdate, offServiceWorkerUpdate } from '@/lib/serviceWorker'

export function PwaUpdatePrompt() {
  const { t } = useTranslation()

  useEffect(() => {
    onServiceWorkerUpdate(() => {
      showToast.info(t('pwa.updatePrompt'), {
        description: t('pwa.refreshDescription'),
        action: {
          label: t('pwa.update'),
          onClick: () => window.location.reload(),
        },
        duration: Infinity,
      })
    })
    return () => offServiceWorkerUpdate()
  }, [t])

  return null
}
