import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { MobileSheetHost } from './MobileSheetHost'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { installWindowSize } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'

interface RenderOptions {
  mobile?: boolean
}

function renderHost(route = '/', options: RenderOptions = {}) {
  installWindowSize(options.mobile === false ? 1024 : 500)
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <MobileSheetHost />
      <LocationCatcher capturedSearch={capturedSearch} />
    </KeyboardShortcutsProvider>,
    {
      route,
      events: true,
      theme: false,
      toaster: false,
      fetchRoutes: appRoutes(),
    },
  )
  return { ...result, capturedSearch }
}

describe('MobileSheetHost', () => {
  it('renders nothing on desktop', () => {
    const { container } = renderHost('/', { mobile: false })

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no mobileTab param is present', () => {
    const { container } = renderHost('/')

    expect(container.firstChild).toBeNull()
  })

  it('renders the session picker sheet when mobileTab=sessions', async () => {
    renderHost('/?mobileTab=sessions')

    expect(await screen.findByRole('dialog', { name: 'Sessions' })).toBeInTheDocument()
  })

  it('renders the file browser sheet when mobileTab=files', async () => {
    renderHost('/?mobileTab=files')

    expect(await screen.findByRole('button', { name: 'Close file browser' })).toBeInTheDocument()
  })

  it('hides the file browser sheet on a linked-server route', async () => {
    const { capturedSearch } = renderHost('/servers/srv_kitchen/sessions/ses_remote?mobileTab=files')

    await waitFor(() => expect(new URLSearchParams(capturedSearch.current).get('mobileTab')).toBe('files'))
    expect(screen.queryByRole('button', { name: 'Close file browser' })).not.toBeInTheDocument()
  })

  it('renders the notifications sheet when mobileTab=notifications', async () => {
    renderHost('/?mobileTab=notifications')

    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('renders the more drawer when mobileTab=more', async () => {
    renderHost('/?mobileTab=more')

    expect(await screen.findByRole('dialog', { name: 'More' })).toBeInTheDocument()
  })

  it('closes the open sheet through its close control', async () => {
    const { capturedSearch } = renderHost('/?mobileTab=more')

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => expect(new URLSearchParams(capturedSearch.current).has('mobileTab')).toBe(false))
  })
})
