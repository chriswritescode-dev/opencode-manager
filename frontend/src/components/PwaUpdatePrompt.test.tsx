import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'

const originalLocation = window.location

function installUpdateSignal() {
  let listener: (() => void) | null = null
  const unsubscribe = vi.fn()
  const props = {
    subscribeToUpdate: (callback: () => void) => {
      listener = callback
    },
    unsubscribeFromUpdate: unsubscribe,
  }
  return {
    ...props,
    unsubscribe,
    signalUpdate: () => {
      if (!listener) throw new Error('update listener was not registered')
      act(() => listener?.())
    },
  }
}

function installReloadSpy() {
  const reload = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...originalLocation, reload },
  })
  return reload
}

describe('PwaUpdatePrompt', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  })

  it('renders nothing until an update is signalled', () => {
    const signal = installUpdateSignal()
    const { container } = render(<PwaUpdatePrompt {...signal} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a status bar with a Reload button when an update is signalled', () => {
    const signal = installUpdateSignal()
    render(<PwaUpdatePrompt {...signal} />)

    signal.signalUpdate()

    expect(screen.getByRole('status')).toHaveTextContent(
      'A new version of OpenCode Manager is available.',
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('reloads the page when Reload is clicked', async () => {
    const reload = installReloadSpy()
    const user = userEvent.setup()
    const signal = installUpdateSignal()
    render(<PwaUpdatePrompt {...signal} />)

    signal.signalUpdate()
    await user.click(screen.getByRole('button', { name: 'Reload' }))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stops listening for updates on unmount', () => {
    const signal = installUpdateSignal()
    const { unmount } = render(<PwaUpdatePrompt {...signal} />)

    unmount()

    expect(signal.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
