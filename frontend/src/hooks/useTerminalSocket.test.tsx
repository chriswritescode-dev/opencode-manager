import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTerminalSocket } from './useTerminalSocket'

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  binaryType = 'blob'
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  message(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent)
  }

  serverClose(code: number) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code } as CloseEvent)
  }
}

function metaFrame(cursor: number): ArrayBuffer {
  const payload = new TextEncoder().encode(JSON.stringify({ cursor }))
  const bytes = new Uint8Array(payload.length + 1)
  bytes[0] = 0x00
  bytes.set(payload, 1)
  return bytes.buffer
}

function renderSocket(overrides: Partial<Parameters<typeof useTerminalSocket>[0]> = {}) {
  return renderHook(() =>
    useTerminalSocket({
      target: { kind: 'repo', repoId: 1 },
      directory: '/work/repo',
      ptyID: 'pty-1',
      onOutput: vi.fn(),
      onExit: vi.fn(),
      enabled: true,
      ...overrides,
    }),
  )
}

describe('useTerminalSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('includes the directory in the connection url', () => {
    renderSocket()
    const url = new URL(FakeWebSocket.instances[0].url)
    expect(url.pathname).toBe('/api/repos/1/terminals/pty-1/connect')
    expect(url.searchParams.get('directory')).toBe('/work/repo')
  })

  it('builds the connection url for a linked server target', () => {
    renderSocket({ target: { kind: 'server', serverId: 'srv_kitchen' } })
    const url = new URL(FakeWebSocket.instances[0].url)
    expect(url.pathname).toBe('/api/opencode-servers/srv_kitchen/terminals/pty-1/connect')
    expect(url.searchParams.get('directory')).toBe('/work/repo')
  })

  it('accumulates the cursor and sends it when reconnecting after 1006', () => {
    renderSocket()
    const first = FakeWebSocket.instances[0]

    act(() => {
      first.open()
      first.message(metaFrame(5))
      first.message('abc')
    })

    act(() => {
      first.serverClose(1006)
    })

    expect(FakeWebSocket.instances).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(FakeWebSocket.instances).toHaveLength(2)
    const second = new URL(FakeWebSocket.instances[1].url)
    expect(second.searchParams.get('cursor')).toBe('8')
    expect(second.searchParams.get('directory')).toBe('/work/repo')
  })

  it('calls onExit without reconnecting on close code 4404', () => {
    const onExit = vi.fn()
    renderSocket({ onExit })

    act(() => {
      FakeWebSocket.instances[0].serverClose(4404)
    })
    act(() => {
      vi.advanceTimersByTime(60000)
    })

    expect(onExit).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('exhausts the retry budget when upstream connections keep failing after open', () => {
    const { result } = renderSocket()
    const delays = [1000, 2000, 5000, 5000, 5000]

    for (const delay of delays) {
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      act(() => {
        socket.open()
        socket.serverClose(1011)
      })
      expect(result.current.status).toBe('reconnecting')
      act(() => {
        vi.advanceTimersByTime(delay)
      })
    }

    const finalSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    act(() => {
      finalSocket.open()
      finalSocket.serverClose(1011)
    })

    expect(result.current.status).toBe('closed')
    expect(FakeWebSocket.instances).toHaveLength(6)

    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(FakeWebSocket.instances).toHaveLength(6)
  })

  it('resets the retry budget only after a healthy upstream session', () => {
    const { result } = renderSocket()

    act(() => {
      FakeWebSocket.instances[0].open()
      FakeWebSocket.instances[0].message(metaFrame(0))
      FakeWebSocket.instances[0].serverClose(1011)
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(FakeWebSocket.instances).toHaveLength(2)
    act(() => {
      FakeWebSocket.instances[1].open()
      FakeWebSocket.instances[1].serverClose(1011)
    })
    expect(result.current.status).toBe('reconnecting')
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('forwards send to the open socket', () => {
    const { result } = renderSocket()
    const socket = FakeWebSocket.instances[0]

    act(() => {
      socket.open()
    })
    act(() => {
      result.current.send('ls\n')
    })

    expect(socket.sent).toContain('ls\n')
  })

  it('does not connect when disabled', () => {
    renderSocket({ enabled: false })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
