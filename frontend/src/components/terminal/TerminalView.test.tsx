import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef, type ComponentProps } from 'react'
import { act, render } from '@testing-library/react'
import { installMatchMedia, installResizeObserver, installWebSocket, type WebSocketFake } from '@/test/browserFakes'
import { createFetchFake, type FetchFake } from '@/test/fetchFake'
import { TerminalView, type TerminalViewHandle } from './TerminalView'

function xtermInput(): HTMLTextAreaElement {
  const textarea = document.querySelector('.xterm-helper-textarea')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('xterm helper textarea missing')
  return textarea
}

function pressKey(key: string, keyCode: number) {
  act(() => {
    xtermInput().dispatchEvent(
      new KeyboardEvent('keydown', { key, keyCode, which: keyCode, code: `Key${key.toUpperCase()}`, bubbles: true }),
    )
  })
}

function terminalContainer(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-terminal-id="t1"]')
  if (!(element instanceof HTMLElement)) throw new Error('terminal container missing')
  return element
}

function setVisibleSize(container: HTMLElement) {
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
}

let socketFake: WebSocketFake
let fetchFake: FetchFake

function renderView(overrides: Partial<ComponentProps<typeof TerminalView>> = {}) {
  const ref = createRef<TerminalViewHandle>()
  const onCtrlConsumed = vi.fn()
  const view = render(
    <TerminalView
      ref={ref}
      target={{ kind: 'repo', repoId: 1 }}
      directory="/repo"
      ptyID="t1"
      active
      ctrlArmed={false}
      onCtrlConsumed={onCtrlConsumed}
      onOpenLink={vi.fn()}
      onExited={vi.fn()}
      {...overrides}
    />,
  )
  return { ref, onCtrlConsumed, view }
}

function openSocket() {
  const connection = socketFake.connectionFor('/terminals/t1/connect')
  if (!connection) throw new Error('terminal socket missing')
  act(() => connection.open())
  return connection
}

beforeEach(() => {
  installMatchMedia(false)
  socketFake = installWebSocket()
  fetchFake = createFetchFake([
    { method: 'PATCH', path: '/api/repos/1/terminals/t1', respond: () => ({ status: 204 }) },
  ])
  fetchFake.install()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalView input handling', () => {
  it('applies the ctrl modifier and consumes it for imperative key-bar sends', () => {
    const { ref, onCtrlConsumed } = renderView({ ctrlArmed: true })
    const connection = openSocket()

    act(() => {
      ref.current?.send('c')
    })

    expect(connection.sent).toEqual(['\u0003'])
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)
  })

  it('applies the ctrl modifier to keyboard input while armed', () => {
    const { onCtrlConsumed } = renderView({ ctrlArmed: true })
    const connection = openSocket()

    pressKey('c', 67)

    expect(connection.sent).toEqual(['\u0003'])
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)
  })

  it('consumes ctrl exactly once so subsequent keyboard input is unmodified', () => {
    const ref = createRef<TerminalViewHandle>()
    const onCtrlConsumed = vi.fn()
    const props: ComponentProps<typeof TerminalView> = {
      target: { kind: 'repo', repoId: 1 },
      directory: '/repo',
      ptyID: 't1',
      active: true,
      ctrlArmed: true,
      onCtrlConsumed,
      onOpenLink: vi.fn(),
      onExited: vi.fn(),
    }

    const { rerender } = render(<TerminalView ref={ref} {...props} />)
    const connection = openSocket()

    act(() => {
      ref.current?.send('c')
    })
    expect(connection.sent).toEqual(['\u0003'])
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)

    rerender(<TerminalView ref={ref} {...props} ctrlArmed={false} />)

    pressKey('c', 67)

    expect(connection.sent).toEqual(['\u0003', 'c'])
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalView resize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('sends a resize only when the fitted size changes', () => {
    const resizeObserver = installResizeObserver()
    const { view } = renderView()
    setVisibleSize(terminalContainer(view.container))

    act(() => {
      vi.advanceTimersByTime(150)
    })
    const resizeRequests = fetchFake.findRequests('PATCH', '/api/repos/1/terminals/t1')
    expect(resizeRequests).toHaveLength(1)
    expect(resizeRequests[0].body).toMatchObject({ directory: '/repo' })

    act(() => {
      resizeObserver.reportHeight(400)
      vi.advanceTimersByTime(150)
    })
    act(() => {
      resizeObserver.reportHeight(400)
      vi.advanceTimersByTime(150)
    })

    expect(fetchFake.findRequests('PATCH', '/api/repos/1/terminals/t1')).toHaveLength(1)
  })

  it('does not send a resize while the view is hidden', () => {
    installResizeObserver()
    const { view } = renderView({ active: false })
    setVisibleSize(terminalContainer(view.container))

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(fetchFake.findRequests('PATCH', '/api/repos/1/terminals/t1')).toHaveLength(0)
  })

  it('does not send a resize when the container has no size', () => {
    installResizeObserver()
    renderView()

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(fetchFake.findRequests('PATCH', '/api/repos/1/terminals/t1')).toHaveLength(0)
  })
})
