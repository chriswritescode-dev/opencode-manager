import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ComposerActivityBar } from './ComposerActivityBar'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { stubMatchMedia } from '@/test/test-utils'

const originalMatchMedia = window.matchMedia

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

const trackOf = (bar: HTMLElement) => bar.firstElementChild as HTMLElement

describe('ComposerActivityBar', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
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

  it('sits inside the docked composer on mobile and below the composer on desktop', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const bar = screen.getByRole('progressbar', { name: 'Session working' })
    expect(bar).toHaveClass('pointer-events-none', 'flex')
    expect(bar).toHaveClass('absolute', 'inset-x-3', 'bottom-1', 'md:-bottom-[11px]')
    expect(bar).not.toHaveClass('fixed')
  })

  it('renders a masked segment track with only the sweeping window', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const track = trackOf(screen.getByRole('progressbar', { name: 'Session working' }))
    expect(track).toHaveClass('scanner-track', 'relative', 'h-2', 'w-full')

    const children = Array.from(track.children) as HTMLElement[]
    expect(children).toHaveLength(1)
    expect(children[0]).toHaveClass('scanner-sweep')
  })

  it('tints the track with the info tone while the session is busy', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const track = trackOf(screen.getByRole('progressbar', { name: 'Session working' }))
    expect(track).toHaveClass('text-info')
  })

  it('tints the track with the primary tone while compacting', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'compact' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const track = trackOf(screen.getByRole('progressbar', { name: 'Compacting' }))
    expect(track).toHaveClass('text-primary')
  })

  it('reports the retry attempt in the label with the warning tone', () => {
    useSessionStatus.getState().setStatus('session-a', {
      type: 'retry',
      attempt: 2,
      message: 'rate limited',
      next: Date.now() + 5_000,
    })

    render(<ComposerActivityBar sessionID="session-a" />)

    const track = trackOf(screen.getByRole('progressbar', { name: 'Retrying (Retry #2)' }))
    expect(track).toHaveClass('text-warning')
  })

  it('tints the track with the muted foreground tone for background activity', () => {
    useSessionStatus.getState().setShellRunning('shell-1', 'session-a', '/repo')

    render(<ComposerActivityBar sessionID="session-a" />)

    const track = trackOf(screen.getByRole('progressbar', { name: 'Background tasks running' }))
    expect(track).toHaveClass('text-muted-foreground')
  })

  it('keeps sweeping when reduced motion is requested', () => {
    stubMatchMedia(true)
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    render(<ComposerActivityBar sessionID="session-a" />)

    const track = trackOf(screen.getByRole('progressbar', { name: 'Session working' }))
    expect(track.querySelector('.scanner-sweep')).not.toBeNull()
  })
})
