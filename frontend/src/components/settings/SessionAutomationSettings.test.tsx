import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionAutomationSettings } from './SessionAutomationSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { installPointerCapture } from '@/test/browserFakes'

function renderAutomation(initial: Parameters<typeof createSettingsServer>[0] = {}) {
  installPointerCapture()
  const settings = createSettingsServer(initial)
  const result = renderWithProviders(<SessionAutomationSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: settings.routes,
  })
  return { ...result, settings }
}

describe('SessionAutomationSettings', () => {
  it('defaults the select to ask every time', async () => {
    renderAutomation()

    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(
      await screen.findByRole('combobox', { name: 'Default permission mode for new sessions' }),
    ).toHaveTextContent('Ask every time')
  })

  it('persists the chosen default permission mode immediately', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderAutomation()

    await user.click(
      await screen.findByRole('combobox', { name: 'Default permission mode for new sessions' }),
    )
    await user.click(screen.getByRole('option', { name: 'Accept everything' }))

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toEqual({
      preferences: { sessionDefaults: { permissionMode: 'auto' } },
    })
    expect(
      screen.getByRole('combobox', { name: 'Default permission mode for new sessions' }),
    ).toHaveTextContent('Accept everything')
  })

  it('renders no goal controls', async () => {
    renderAutomation({ sessionDefaults: { permissionMode: 'ask' } })

    expect(
      await screen.findByRole('combobox', { name: 'Default permission mode for new sessions' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Goal auditor model')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Max automatic continuations')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Token budget per goal')).not.toBeInTheDocument()
  })
})
