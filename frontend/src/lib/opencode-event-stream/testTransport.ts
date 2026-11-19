import type { SSESubscribeRequest, SSEVisibilityRequest } from '@opencode-manager/shared/schemas'
import type { JsonValue } from '@opencode-manager/shared/utils'
import type { EventStreamConnection, EventStreamTransport, EventStreamTransportHandlers } from './types'

export class TestEventStreamTransport implements EventStreamTransport {
  readonly posts: Array<{ path: string; body: SSESubscribeRequest | SSEVisibilityRequest }> = []
  readonly openedUrls: string[] = []
  closeCount = 0
  private handlers: EventStreamTransportHandlers | null = null
  private connection: EventStreamConnection | null = null

  open(url: string, handlers: EventStreamTransportHandlers): EventStreamConnection {
    this.openedUrls.push(url)
    this.handlers = handlers
    this.connection = {
      close: () => {
        if (this.connection) {
          this.connection = null
          this.closeCount += 1
        }
      },
    }
    return this.connection
  }

  async post(path: string, body: SSESubscribeRequest | SSEVisibilityRequest): Promise<boolean> {
    this.posts.push({ path, body })
    return true
  }

  openConnection(): void {
    this.handlers?.onOpen()
  }

  connected(clientId = 'test-client'): void {
    this.connectedPayload({ clientId })
  }

  connectedPayload(payload: JsonValue): void {
    this.handlers?.onConnected(JSON.stringify(payload))
  }

  message(data: JsonValue): void {
    this.handlers?.onMessage(JSON.stringify(data))
  }

  heartbeat(): void {
    this.handlers?.onHeartbeat()
  }

  resync(payload?: JsonValue): void {
    this.handlers?.onResync(payload === undefined ? undefined : JSON.stringify(payload))
  }

  fail(): void {
    this.handlers?.onError()
  }
}
