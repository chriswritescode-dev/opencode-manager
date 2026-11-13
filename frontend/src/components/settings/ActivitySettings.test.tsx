import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installPointerCapture } from '@/test/browserFakes'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { renderWithProviders } from '@/test/render'
import { ActivitySettings } from './ActivitySettings'

function renderActivitySettings(settingsServer = createSettingsServer()) {
  installPointerCapture()
  return renderWithProviders(<ActivitySettings />, { fetchRoutes: settingsServer.routes })
}

describe('ActivitySettings', () => {
  it('shows the default window when the preference is unset', async () => {
    renderActivitySettings()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Recent activity window' })).toHaveTextContent(
        '30 minutes',
      ),
    )
  })

  it('shows the stored window', async () => {
    renderActivitySettings(createSettingsServer({ activityWindowMinutes: 120 }))

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Recent activity window' })).toHaveTextContent(
        '2 hours',
      ),
    )
  })

  it('saves the chosen window in minutes', async () => {
    const user = userEvent.setup()
    const settingsServer = createSettingsServer()
    const { fetchFake } = renderActivitySettings(settingsServer)

    await user.click(await screen.findByRole('combobox', { name: 'Recent activity window' }))
    await user.click(screen.getByRole('option', { name: '4 hours' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toMatchObject({
        preferences: { activityWindowMinutes: 240 },
      }),
    )
    expect(settingsServer.preferences().activityWindowMinutes).toBe(240)
  })
})
