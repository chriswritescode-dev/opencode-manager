import type { EventStreamConnection, EventStreamTransport, EventStreamTransportHandlers } from './types'

export class TestEventStreamTransport implements EventStreamTransport {
  readonly posts: Array<{ path: string; body: unknown }> = []
  closeCount = 0
  private handlers: EventStreamTransportHandlers | null = null
  private connection: EventStreamConnection | null = null

  open(_url: string, handlers: EventStreamTransportHandlers): EventStreamConnection {
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

  async post(path: string, body: unknown): Promise<boolean> {
    this.posts.push({ path, body })
    return true
  }

  openConnection(): void {
    this.handlers?.onOpen()
  }

  connected(clientId = 'test-client'): void {
    this.handlers?.onConnected(JSON.stringify({ clientId }))
  }

  message(data: unknown): void {
    this.handlers?.onMessage(JSON.stringify(data))
  }

  heartbeat(): void {
    this.handlers?.onHeartbeat()
  }

  fail(): void {
    this.handlers?.onError()
  }
}
