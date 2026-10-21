import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerActivityBar } from './ComposerActivityBar'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { stubMatchMedia } from '@/test/test-utils'

const originalMatchMedia = window.matchMedia
const originalResizeObserver = global.ResizeObserver

class MockResizeObserver {
  static instances: MockResizeObserver[] = []

  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  trigger(width: number) {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

const resetStore = () => {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    parents: new Map(),
    directories: new Map(),
    runningShells: new Map(),
    revision: 0,
  })
}

const segmentsOf = (bar: HTMLElement) =>
  Array.from(bar.firstElementChild?.children ?? []) as HTMLElement[]

const measureWidth = (width: number) => {
  act(() => {
    MockResizeObserver.instances.forEach((instance) => instance.trigger(width))
  })
}

describe('ComposerActivityBar', () => {
  beforeEach(() => {
    resetStore()
    MockResizeObserver.instances = []
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    vi.useRealTimers()
    global.ResizeObserver = originalResizeObserver
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    })
  })

  it('renders nothing when the session is idle without background activity', () => {
    const { container } = render(<ComposerActivityBar sessionID="session-a" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('anchors a pointer-transparent progressbar in the gap below the composer', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    expect(bar).toHaveClass('pointer-events-none')
    expect(bar).toHaveClass('absolute')
    expect(bar).toHaveClass('inset-x-3')
    expect(bar).toHaveClass('-bottom-[13px]')
    expect(bar).toHaveClass('md:-bottom-[11px]')
    expect(bar).toHaveClass('flex')
  })

  it('fills the measured width with 4x8 segments', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    expect(bar.firstElementChild).toHaveClass('gap-0.5')

    measureWidth(602)

    const segments = segmentsOf(bar)
    expect(segments).toHaveLength(100)
    expect(segments[0]).toHaveClass('w-1')
    expect(segments[0]).toHaveClass('h-2')
    expect(segments[0]).toHaveClass('rounded-[1px]')
    expect(segments[0]).toHaveClass('transition-colors')
    expect(segments[0]).toHaveClass('duration-75')
    expect(segments[0]).not.toHaveClass('flex-1')
  })

  it('keeps the minimum segment count for narrow containers', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    measureWidth(20)

    expect(segmentsOf(bar)).toHaveLength(12)
  })

  it('lights the info tiers around the scanner window', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    measureWidth(602)

    const segments = segmentsOf(screen.getByRole('progressbar', { name: 'Session working' }))
    expect(segments[3]).toHaveClass('bg-info')
    expect(segments[4]).toHaveClass('bg-info/70')
    expect(segments[6]).toHaveClass('bg-info/40')
    expect(segments[7]).toHaveClass('bg-info/20')
    expect(segments[8]).toHaveClass('bg-muted/20')
    expect(segments[99]).toHaveClass('bg-muted/20')
  })

  it('renders the compacting state with primary colors', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'compact' })

    render(<ComposerActivityBar sessionID="session-a" />)

    measureWidth(602)

    const segments = segmentsOf(screen.getByRole('progressbar', { name: 'Compacting' }))
    expect(segments[3]).toHaveClass('bg-primary')
    expect(segments[4]).toHaveClass('bg-primary/70')
    expect(segments[6]).toHaveClass('bg-primary/40')
    expect(segments[7]).toHaveClass('bg-primary/20')
    expect(segments[8]).toHaveClass('bg-muted/20')
  })

  it('reports the retry attempt in the label with warning colors', () => {
    useSessionStatus.getState().setStatus('session-a', {
      type: 'retry',
      attempt: 2,
      message: 'rate limited',
      next: Date.now() + 5_000,
    })

    render(<ComposerActivityBar sessionID="session-a" />)

    measureWidth(602)

    const segments = segmentsOf(screen.getByRole('progressbar', { name: 'Retrying (Retry #2)' }))
    expect(segments[3]).toHaveClass('bg-warning')
    expect(segments[4]).toHaveClass('bg-warning/70')
    expect(segments[6]).toHaveClass('bg-warning/40')
    expect(segments[7]).toHaveClass('bg-warning/20')
    expect(segments[8]).toHaveClass('bg-muted/20')
  })

  it('renders the muted background activity state when idle with a running shell', () => {
    useSessionStatus.getState().setShellRunning('shell-1', 'session-a', '/repo')

    render(<ComposerActivityBar sessionID="session-a" />)

    measureWidth(602)

    const segments = segmentsOf(screen.getByRole('progressbar', { name: 'Background tasks running' }))
    expect(segments[3]).toHaveClass('bg-muted-foreground')
    expect(segments[4]).toHaveClass('bg-muted-foreground/70')
    expect(segments[6]).toHaveClass('bg-muted-foreground/40')
    expect(segments[7]).toHaveClass('bg-muted-foreground/20')
    expect(segments[8]).toHaveClass('bg-muted/20')
  })

  it('sweeps the lit window on the step interval', () => {
    vi.useFakeTimers()
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    measureWidth(602)
    expect(segmentsOf(bar)[3]).toHaveClass('bg-info')

    act(() => {
      vi.advanceTimersByTime(120)
    })

    const segments = segmentsOf(bar)
    expect(segments[7]).toHaveClass('bg-info')
    expect(segments[4]).toHaveClass('bg-info/40')
  })

  it('renders every segment statically when reduced motion is requested', () => {
    vi.useFakeTimers()
    stubMatchMedia(true)
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    measureWidth(602)
    act(() => {
      vi.advanceTimersByTime(600)
    })

    const segments = segmentsOf(bar)
    expect(segments).toHaveLength(100)
    expect(segments.every((segment) => segment.classList.contains('bg-info/60'))).toBe(true)
    expect(segments.some((segment) => segment.classList.contains('bg-muted/20'))).toBe(false)
  })
})
