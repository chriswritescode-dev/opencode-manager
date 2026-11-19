import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTerminalSocket } from './useTerminalSocket'
import { installWebSocket, type WebSocketFake } from '@/test/browserFakes'

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
  let sockets: WebSocketFake

  function connection(index: number) {
    const socket = sockets.instances[index]
    if (!socket) throw new Error(`no websocket at index ${index}`)
    return socket
  }

  beforeEach(() => {
    sockets = installWebSocket()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('includes the directory in the connection url', () => {
    renderSocket()
    const url = new URL(connection(0).url)
    expect(url.pathname).toBe('/api/repos/1/terminals/pty-1/connect')
    expect(url.searchParams.get('directory')).toBe('/work/repo')
  })

  it('builds the connection url for a linked server target', () => {
    renderSocket({ target: { kind: 'server', serverId: 'srv_kitchen' } })
    const url = new URL(connection(0).url)
    expect(url.pathname).toBe('/api/opencode-servers/srv_kitchen/terminals/pty-1/connect')
    expect(url.searchParams.get('directory')).toBe('/work/repo')
  })

  it('accumulates the cursor and sends it when reconnecting after 1006', () => {
    renderSocket()
    const first = connection(0)

    act(() => {
      first.open()
      first.message(metaFrame(5))
      first.message('abc')
    })

    act(() => {
      first.serverClose(1006)
    })

    expect(sockets.instances).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(sockets.instances).toHaveLength(2)
    const second = new URL(connection(1).url)
    expect(second.searchParams.get('cursor')).toBe('8')
    expect(second.searchParams.get('directory')).toBe('/work/repo')
  })

  it('calls onExit without reconnecting on close code 4404', () => {
    const onExit = vi.fn()
    renderSocket({ onExit })

    act(() => {
      connection(0).serverClose(4404)
    })
    act(() => {
      vi.advanceTimersByTime(60000)
    })

    expect(onExit).toHaveBeenCalledTimes(1)
    expect(sockets.instances).toHaveLength(1)
  })

  it('exhausts the retry budget when upstream connections keep failing after open', () => {
    const { result } = renderSocket()
    const delays = [1000, 2000, 5000, 5000, 5000]

    for (const delay of delays) {
      const socket = connection(sockets.instances.length - 1)
      act(() => {
        socket.open()
        socket.serverClose(1011)
      })
      expect(result.current.status).toBe('reconnecting')
      act(() => {
        vi.advanceTimersByTime(delay)
      })
    }

    const finalSocket = connection(sockets.instances.length - 1)
    act(() => {
      finalSocket.open()
      finalSocket.serverClose(1011)
    })

    expect(result.current.status).toBe('closed')
    expect(sockets.instances).toHaveLength(6)

    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(sockets.instances).toHaveLength(6)
  })

  it('resets the retry budget only after a healthy upstream session', () => {
    const { result } = renderSocket()

    act(() => {
      connection(0).open()
      connection(0).message(metaFrame(0))
      connection(0).serverClose(1011)
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(sockets.instances).toHaveLength(2)
    act(() => {
      connection(1).open()
      connection(1).serverClose(1011)
    })
    expect(result.current.status).toBe('reconnecting')
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(sockets.instances).toHaveLength(3)
  })

  it('forwards send to the open socket', () => {
    const { result } = renderSocket()
    const socket = connection(0)

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
    expect(sockets.instances).toHaveLength(0)
  })
})
