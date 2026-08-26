import { useEffect } from 'react'

export const SIDEBAR_ACTIONS = ['new-session', 'new-repo', 'new-schedule'] as const

export type SidebarActionKey = (typeof SIDEBAR_ACTIONS)[number]

const SIDEBAR_ACTION_EVENT = 'oc:sidebar:action'

const handlerCounts = new Map<SidebarActionKey, number>()

export function emitSidebarAction(action: SidebarActionKey) {
  if (!handlerCounts.get(action)) {
    console.warn(`Sidebar action "${action}" was dispatched but no mounted page handles it`)
  }
  window.dispatchEvent(new CustomEvent(SIDEBAR_ACTION_EVENT, { detail: { action } }))
}

export function useSidebarAction(action: SidebarActionKey, handler: () => void) {
  useEffect(() => {
    handlerCounts.set(action, (handlerCounts.get(action) ?? 0) + 1)
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: SidebarActionKey }>).detail
      if (detail?.action === action) {
        handler()
      }
    }
    window.addEventListener(SIDEBAR_ACTION_EVENT, listener)
    return () => {
      window.removeEventListener(SIDEBAR_ACTION_EVENT, listener)
      handlerCounts.set(action, Math.max(0, (handlerCounts.get(action) ?? 1) - 1))
    }
  }, [action, handler])
}
