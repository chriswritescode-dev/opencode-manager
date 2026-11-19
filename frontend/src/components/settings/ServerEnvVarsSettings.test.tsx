import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServerEnvVarsSettings } from './ServerEnvVarsSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'

function renderEnvVars(serverEnvVars: Array<{ key: string, value: string }> = []) {
  const settings = createSettingsServer({ serverEnvVars })
  const result = renderWithProviders(<ServerEnvVarsSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: settings.routes,
  })
  return { ...result, settings }
}

describe('ServerEnvVarsSettings', () => {
  it('saves only the server environment variables', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEnvVars([{ key: 'FOO', value: 'bar' }])

    await user.click(screen.getByRole('button', { name: /Server Environment Variables/i }))
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(fetchFake.lastRequest('PATCH', '/api/settings')?.body).toEqual({
      preferences: { serverEnvVars: [{ key: 'FOO', value: 'bar' }] },
    })
    expect(await screen.findByText('Environment variables saved')).toBeInTheDocument()
    expect(
      screen.getByText('Restart the OpenCode server to apply environment variable changes.'),
    ).toBeInTheDocument()
  })

  it('reports a failed save', async () => {
    const user = userEvent.setup()
    const settings = createSettingsServer({}, { patch: () => ({ status: 500, json: { error: 'write failed' } }) })
    renderWithProviders(<ServerEnvVarsSettings />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: settings.routes,
    })

    await user.click(screen.getByRole('button', { name: /Server Environment Variables/i }))
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(await screen.findByText('Failed to save environment variables')).toBeInTheDocument()
  })

  it('does not render a default variables section', async () => {
    const user = userEvent.setup()
    renderEnvVars()

    await user.click(screen.getByRole('button', { name: /Server Environment Variables/i }))

    expect(screen.queryByText('Default variables')).not.toBeInTheDocument()
    expect(screen.queryByText(/OPENCODE_EXPERIMENTAL_WORKSPACES/)).not.toBeInTheDocument()
  })
})
