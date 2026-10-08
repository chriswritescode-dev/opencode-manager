import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { useGlobalShortcutActions } from './useGlobalShortcutActions'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  createSession: vi.fn(),
  useMobile: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    preferences: { leaderKey: 'Ctrl+O', keyboardShortcuts: {}, directShortcuts: undefined },
  }),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
}))

vi.mock('@/api/opencode', () => ({
  createSession: mocks.createSession,
}))

function Harness() {
  useGlobalShortcutActions()
  return null
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function pressKey(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    document.body.dispatchEvent(event)
  })
  return event
}

describe('useGlobalShortcutActions', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.useMobile.mockReturnValue(false)
    mocks.getRepo.mockResolvedValue({ id: 5, fullPath: '/repo/five' })
    mocks.createSession.mockResolvedValue({ id: 'session-new' })
  })

  afterEach(() => {
    queryClient.clear()
  })

  function renderHarness(initialEntry: string) {
    render(
      <QueryClientProvider client={queryClient}>
        <KeyboardShortcutsProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Harness />
            <LocationDisplay />
          </MemoryRouter>
        </KeyboardShortcutsProvider>
      </QueryClientProvider>,
    )
    return {
      location: () => screen.getByTestId('location').textContent,
    }
  }

  it('opens the terminal dialog on the assistant host from the root route', async () => {
    const { location } = renderHarness('/')

    pressKey({ key: '`', ctrlKey: true })

    await waitFor(() => expect(location()).toBe('/assistant?dialog=terminal'))
  })

  it('navigates to the nearest repo host from a repo sub-route without the tool', async () => {
    const { location } = renderHarness('/repos/5/schedules')

    pressKey({ key: '`', ctrlKey: true })

    await waitFor(() => expect(location()).toBe('/repos/5?dialog=terminal'))
  })

  it('toggles the docked panel on and off when the route hosts the tool', async () => {
    const { location } = renderHarness('/repos/5')

    pressKey({ key: '`', ctrlKey: true })
    await waitFor(() => expect(location()).toBe('/repos/5?panel=terminal'))

    pressKey({ key: '`', ctrlKey: true })
    await waitFor(() => expect(location()).toBe('/repos/5'))
  })

  it('toggles the dialog instead of the panel on mobile', async () => {
    mocks.useMobile.mockReturnValue(true)
    const { location } = renderHarness('/repos/5')

    pressKey({ key: '`', ctrlKey: true })

    await waitFor(() => expect(location()).toBe('/repos/5?dialog=terminal'))
  })

  it('creates a session in the repo directory and navigates to it from the leader shortcut', async () => {
    queryClient.setQueryData(['repo', 5], { id: 5, fullPath: '/repo/five' })
    const { location } = renderHarness('/repos/5')

    pressKey({ key: 'o', ctrlKey: true })
    pressKey({ key: 'n' })

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledWith({ directory: '/repo/five' }))
    await waitFor(() => expect(location()).toBe('/repos/5/sessions/session-new'))
  })

  it('does not swallow the follow-up key when the route has no new-session host', async () => {
    renderHarness('/')

    pressKey({ key: 'o', ctrlKey: true })
    const followUp = pressKey({ key: 'n' })

    expect(followUp.defaultPrevented).toBe(false)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
