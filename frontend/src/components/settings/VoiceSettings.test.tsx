import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { VoiceSettings } from './VoiceSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { installPointerCapture, installSpeechRecognition, installSpeechSynthesis } from '@/test/browserFakes'

describe('VoiceSettings', () => {
  it('renders TTS and STT as top-aligned equal columns split at 1000px of container width', async () => {
    installPointerCapture()
    installSpeechRecognition()
    installSpeechSynthesis(['Alex'])
    const settings = createSettingsServer()

    renderWithProviders(<VoiceSettings />, {
      tts: true,
      fetchRoutes: settings.routes,
    })

    const ttsSection = (await screen.findByRole('heading', { name: 'Text-to-Speech' })).closest('div.bg-card')
    const sttSection = screen.getByRole('heading', { name: 'Speech-to-Text' }).closest('div.bg-card')
    const ttsColumn = ttsSection?.parentElement
    const sttColumn = sttSection?.parentElement

    expect(ttsColumn).toHaveClass('min-w-0')
    expect(sttColumn).toHaveClass('min-w-0')
    expect(ttsColumn?.parentElement).toBe(sttColumn?.parentElement)
    expect(ttsColumn?.parentElement).toHaveClass('grid', '@min-[1000px]:grid-cols-2', '@min-[1000px]:items-start')
    expect(ttsColumn?.parentElement?.parentElement).toHaveClass('@container', 'w-full', 'max-w-7xl')
    expect(ttsColumn?.parentElement?.firstElementChild).toBe(ttsColumn)
  })
})
