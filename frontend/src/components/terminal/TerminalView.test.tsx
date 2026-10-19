import { createRef, type ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { resizeTerminal } from '@/api/terminals'
import { TerminalView, type TerminalViewHandle } from './TerminalView'

const xterm = vi.hoisted(() => {
  const onDataHandlers: Array<(data: string) => void> = []
  return {
    onDataHandlers,
    write: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
  }
})

const socket = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: xterm.write,
    focus: xterm.focus,
    dispose: xterm.dispose,
    onData: (handler: (data: string) => void) => {
      xterm.onDataHandlers.push(handler)
      return { dispose: vi.fn() }
    },
    options: {},
    cols: 80,
    rows: 24,
  })),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@/api/terminals', () => ({
  resizeTerminal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/terminal-theme', () => ({
  resolveTerminalTheme: vi.fn(() => ({})),
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
  useTerminalSocket: () => ({ send: socket.send, status: 'open' }),
}))

function renderView(overrides: Partial<ComponentProps<typeof TerminalView>> = {}) {
  const ref = createRef<TerminalViewHandle>()
  const onCtrlConsumed = vi.fn()
  const element = (
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
    />
  )
  const view = render(element)
  return { ref, onCtrlConsumed, view }
}

describe('TerminalView input handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    xterm.onDataHandlers.length = 0
  })

  it('applies the ctrl modifier and consumes it for imperative key-bar sends', () => {
    const { ref, onCtrlConsumed } = renderView({ ctrlArmed: true })

    act(() => {
      ref.current?.send('c')
    })

    expect(socket.send).toHaveBeenCalledWith('\x03')
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)
  })

  it('applies the ctrl modifier to keyboard input while armed', () => {
    const { onCtrlConsumed } = renderView({ ctrlArmed: true })

    act(() => {
      xterm.onDataHandlers[0]('c')
    })

    expect(socket.send).toHaveBeenCalledWith('\x03')
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

    act(() => {
      ref.current?.send('c')
    })
    expect(socket.send).toHaveBeenLastCalledWith('\x03')
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)

    rerender(<TerminalView ref={ref} {...props} ctrlArmed={false} />)

    act(() => {
      xterm.onDataHandlers[xterm.onDataHandlers.length - 1]('c')
    })

    expect(socket.send).toHaveBeenLastCalledWith('c')
    expect(onCtrlConsumed).toHaveBeenCalledTimes(1)
  })
})

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function setVisibleSize(container: HTMLElement) {
  Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true })
}

describe('TerminalView resize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    TestResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends a resize only when the fitted size changes', () => {
    const { view } = renderView()
    const container = view.container.querySelector('[data-terminal-id="t1"]') as HTMLElement
    setVisibleSize(container)

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(resizeTerminal).toHaveBeenCalledTimes(1)

    act(() => {
      TestResizeObserver.instances[0].trigger()
      vi.advanceTimersByTime(150)
    })
    act(() => {
      TestResizeObserver.instances[0].trigger()
      vi.advanceTimersByTime(150)
    })

    expect(resizeTerminal).toHaveBeenCalledTimes(1)
  })

  it('does not send a resize while the view is hidden', () => {
    const { view } = renderView({ active: false })
    const container = view.container.querySelector('[data-terminal-id="t1"]') as HTMLElement
    setVisibleSize(container)

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(resizeTerminal).not.toHaveBeenCalled()
  })

  it('does not send a resize when the container has no size', () => {
    renderView()

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(resizeTerminal).not.toHaveBeenCalled()
  })
})
