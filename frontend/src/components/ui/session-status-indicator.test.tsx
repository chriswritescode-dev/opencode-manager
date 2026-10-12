import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionStatusIndicator } from './session-status-indicator'
import { useSessionStatus } from '@/stores/sessionStatusStore'

const resetStore = () => {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    parents: new Map(),
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
})
