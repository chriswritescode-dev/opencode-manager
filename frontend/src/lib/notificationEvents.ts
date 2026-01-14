type NotificationEventType = 
  | { type: 'session-complete'; sessionId: string; repoId?: string; sessionTitle?: string }
  | { type: 'permission-request'; sessionId: string; repoId?: string; toolName: string }

type NotificationListener = (event: NotificationEventType) => void

class NotificationEventEmitter {
  private listeners: Set<NotificationListener> = new Set()

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: NotificationEventType): void {
    this.listeners.forEach((listener) => listener(event))
  }
}

export const notificationEvents = new NotificationEventEmitter()
export type { NotificationEventType }
