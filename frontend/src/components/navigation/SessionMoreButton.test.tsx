import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { SessionMoreButton } from './SessionMoreButton'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'

function renderButton(unreadTotal = 0) {
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <SessionMoreButton />
      <LocationCatcher capturedSearch={capturedSearch} />
    </>,
    {
      route: '/repos/1/sessions/ses_1',
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: appRoutes({ unreadSchedules: { runs: [], total: unreadTotal, failed: 0 } }),
    },
  )
  return { ...result, capturedSearch }
}

describe('SessionMoreButton', () => {
  it('shows the unread report count and opens the drawer', async () => {
    const { capturedSearch } = renderButton(4)

    const button = await screen.findByRole('button', { name: 'More, 4 unread reports' })
    expect(screen.getByText('4')).toBeInTheDocument()

    fireEvent.click(button)

    await waitFor(() => expect(capturedSearch.current).toBe('?mobileTab=more'))
  })

  it('shows no count when there are no unread reports', async () => {
    renderButton(0)

    expect(await screen.findByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
