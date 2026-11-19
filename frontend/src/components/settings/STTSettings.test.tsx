import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VOICE_PAUSE_STORAGE_KEY } from '@opencode-manager/shared/opencode'
import type { STTConfig } from '@/api/types/settings'
import { STTSettings } from './STTSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { installPointerCapture, installSpeechRecognition } from '@/test/browserFakes'

function renderSttSettings(stt: Partial<STTConfig> = { enabled: true, provider: 'builtin' }) {
  installPointerCapture()
  installSpeechRecognition()
  const settings = createSettingsServer({ stt: { ...settingsDefaults(), ...stt } })
  const result = renderWithProviders(<STTSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: [
      ...settings.routes,
      { method: 'GET', path: '/api/stt/models', respond: () => ({ json: { models: ['whisper-1'], cached: false } }) },
    ],
  })
  return { ...result, settings }
}

function settingsDefaults(): STTConfig {
  return {
    enabled: false,
    provider: 'builtin',
    endpoint: 'https://api.openai.com',
    apiKey: '',
    model: 'whisper-1',
    language: 'en-US',
    availableModels: [],
    lastModelsFetch: 0,
  }
}

function pauseSelect() {
  return screen.queryByRole('combobox', { name: 'Pause before sending' })
}

describe('STTSettings pause before sending', () => {
  it('shows the pause select for the enabled built-in provider', async () => {
    renderSttSettings()

    expect(await screen.findByRole('combobox', { name: 'Pause before sending' })).toHaveValue('1.2 s')
  })

  it('hides the pause select for the external provider', async () => {
    renderSttSettings({ enabled: true, provider: 'external' })

    expect(await screen.findByLabelText('API Endpoint')).toBeInTheDocument()
    expect(pauseSelect()).not.toBeInTheDocument()
  })

  it('hides the pause select when STT is disabled', async () => {
    renderSttSettings({ enabled: false, provider: 'builtin' })

    expect(await screen.findByRole('switch', { name: /Enable STT/i })).not.toBeChecked()
    expect(pauseSelect()).not.toBeInTheDocument()
  })

  it('writes the selected pause to device-local storage', async () => {
    const user = userEvent.setup()
    renderSttSettings()

    const select = await screen.findByRole('combobox', { name: 'Pause before sending' })
    expect(select).toHaveValue('1.2 s')

    await user.click(select)
    await user.click(screen.getByRole('option', { name: '3.0 s' }))

    expect(window.localStorage.getItem(VOICE_PAUSE_STORAGE_KEY)).toBe('3000')
    expect(pauseSelect()).toHaveValue('3.0 s')
  })
})
