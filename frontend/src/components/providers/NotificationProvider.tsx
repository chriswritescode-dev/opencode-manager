import { useEffect } from 'react'
import { notificationEvents, type NotificationEventType } from '@/lib/notificationEvents'
import { useNotifications } from '@/hooks/useNotifications'

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { notifySessionComplete, notifyPermissionRequest } = useNotifications()

  useEffect(() => {
    const handleEvent = (event: NotificationEventType) => {
      switch (event.type) {
        case 'session-complete':
          notifySessionComplete(event.sessionId, event.repoId, event.sessionTitle)
          break
        case 'permission-request':
          notifyPermissionRequest(event.sessionId, event.repoId, event.toolName)
          break
      }
    }

    const unsubscribe = notificationEvents.subscribe(handleEvent)
    return unsubscribe
  }, [notifySessionComplete, notifyPermissionRequest])

  return <>{children}</>
}
