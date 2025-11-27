import { useState, useEffect } from 'react'

export function useStandalone() {
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const checkStandalone = () => {
      const isIOSStandalone = ('standalone' in window.navigator) && (window.navigator as Navigator & { standalone: boolean }).standalone
      const isDisplayModeStandalone = window.matchMedia('(display-mode: standalone)').matches
      setIsStandalone(isIOSStandalone || isDisplayModeStandalone)
    }

    checkStandalone()

    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    mediaQuery.addEventListener('change', checkStandalone)

    return () => mediaQuery.removeEventListener('change', checkStandalone)
  }, [])

  return isStandalone
}
