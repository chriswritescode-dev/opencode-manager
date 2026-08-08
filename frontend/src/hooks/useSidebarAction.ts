import { useEffect } from 'react'

type SidebarActionKey = 'new-session' | 'new-repo' | 'new-schedule'

export function useSidebarAction(action: SidebarActionKey, handler: () => void) {
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: SidebarActionKey }>).detail
      if (detail?.action === action) {
        handler()
      }
    }
    window.addEventListener('oc:sidebar:action', listener)
    return () => window.removeEventListener('oc:sidebar:action', listener)
  }, [action, handler])
}
