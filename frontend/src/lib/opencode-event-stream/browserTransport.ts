import type { SSESubscribeRequest, SSEVisibilityRequest } from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import type { EventStreamConnection, EventStreamTransport, EventStreamTransportHandlers } from './types'

function eventMessageData(event: Event): string {
  const data = 'data' in event ? event.data : undefined
  const parsed = z.string().safeParse(data)
  return parsed.success ? parsed.data : ''
}

export function createBrowserEventStreamTransport(): EventStreamTransport {
  return {
    open(url: string, handlers: EventStreamTransportHandlers): EventStreamConnection {
      const eventSource = new EventSource(url, { withCredentials: true })

      eventSource.onopen = handlers.onOpen
      eventSource.onerror = handlers.onError
      eventSource.onmessage = (event) => handlers.onMessage(event.data)
      eventSource.addEventListener('connected', (event) => {
        handlers.onConnected(eventMessageData(event))
      })
      eventSource.addEventListener('heartbeat', handlers.onHeartbeat)
      eventSource.addEventListener('resync', (event) => {
        handlers.onResync(eventMessageData(event))
      })

      return {
        close: () => eventSource.close(),
      }
    },

    async post(path: string, body: SSESubscribeRequest | SSEVisibilityRequest): Promise<boolean> {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      return response.ok
    },
  }
}
