import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectivityPill } from './ConnectivityPill'
import { useConnectivityStore } from '@/stores/connectivityStore'
import { openCodeEventStream } from '@/lib/opencode-event-stream'

describe('ConnectivityPill', () => {
  beforeEach(() => {
    act(() => {
      useConnectivityStore.setState({ interrupted: false })
    })
  })

  afterEach(() => {
    act(() => {
      useConnectivityStore.setState({ interrupted: false })
    })
    vi.restoreAllMocks()
  })

  it('renders nothing when the server is reachable and no action was interrupted', () => {
    const { container } = render(<ConnectivityPill serverOffline={false} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('offers a reconnect action while an interrupted action waits for the stream', () => {
    act(() => {
      useConnectivityStore.getState().markInterrupted()
    })
    const reconnectSpy = vi.spyOn(openCodeEventStream, 'reconnectNow')

    render(<ConnectivityPill serverOffline={false} />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')

    const button = screen.getByRole('button', { name: 'Reconnecting…' })
    fireEvent.click(button)

    expect(reconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('hides the pill once the interrupted action resolves without user input', () => {
    render(<ConnectivityPill serverOffline={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      useConnectivityStore.getState().markInterrupted()
    })
    expect(screen.getByRole('button', { name: 'Reconnecting…' })).toBeInTheDocument()

    act(() => {
      useConnectivityStore.getState().clearInterrupted()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a non-interactive notice when the remote server is offline', () => {
    act(() => {
      useConnectivityStore.getState().markInterrupted()
    })

    render(<ConnectivityPill serverOffline />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Server offline')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
