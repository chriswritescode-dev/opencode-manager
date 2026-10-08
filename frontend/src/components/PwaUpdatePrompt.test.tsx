import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'

const mocks = vi.hoisted(() => ({
  onServiceWorkerUpdate: vi.fn(),
  offServiceWorkerUpdate: vi.fn(),
}))

vi.mock('@/lib/serviceWorker', () => ({
  onServiceWorkerUpdate: mocks.onServiceWorkerUpdate,
  offServiceWorkerUpdate: mocks.offServiceWorkerUpdate,
}))

function triggerUpdate() {
  const callback = mocks.onServiceWorkerUpdate.mock.calls[0]?.[0]
  if (typeof callback !== 'function') throw new Error('update callback was not registered')
  act(() => callback())
}

describe('PwaUpdatePrompt', () => {
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.onServiceWorkerUpdate.mockReset()
    mocks.offServiceWorkerUpdate.mockReset()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...window.location, reload: reloadMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing until an update is signalled', () => {
    const { container } = render(<PwaUpdatePrompt />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a status bar with a Reload button when an update is signalled', () => {
    render(<PwaUpdatePrompt />)

    triggerUpdate()

    expect(screen.getByRole('status')).toHaveTextContent(
      'A new version of OpenCode Manager is available.',
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('reloads the page when Reload is clicked', () => {
    render(<PwaUpdatePrompt />)

    triggerUpdate()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes from updates on unmount', () => {
    const { unmount } = render(<PwaUpdatePrompt />)

    unmount()

    expect(mocks.offServiceWorkerUpdate).toHaveBeenCalledTimes(1)
  })
})
