import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionStatusIndicator } from './session-status-indicator'
import { SPINNER_FRAMES, brailleDots } from './activity-spinner'
import { useSessionStatus } from '@/stores/sessionStatusStore'

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

describe('SessionStatusIndicator background activity', () => {
  beforeEach(() => {
    resetStore()
  })

  it('shows the background tasks label when idle with a running shell', () => {
    useSessionStatus.getState().setShellRunning('shell-1', 'session-a', '/repo')

    render(<SessionStatusIndicator sessionID="session-a" showLabel />)

    expect(screen.getByLabelText('Background tasks running')).toBeInTheDocument()
  })

  it('renders nothing when idle without background activity', () => {
    const { container } = render(<SessionStatusIndicator sessionID="session-a" showLabel />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the braille spinner with a running label for a busy session', () => {
    useSessionStatus.getState().setStatus('session-a', { type: 'busy' })

    const { container } = render(<SessionStatusIndicator sessionID="session-a" size="sm" />)

    expect(screen.getByLabelText('Running')).toBeInTheDocument()
    const litDots = container.querySelectorAll('svg[aria-hidden="true"] circle[fill-opacity="1"]')
    expect(litDots).toHaveLength(brailleDots(SPINNER_FRAMES[0]).filter(Boolean).length)
  })
})
