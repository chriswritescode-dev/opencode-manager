import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceSettings } from './VoiceSettings'

vi.mock('./TTSSettings', () => ({
  TTSSettings: () => <div data-testid="tts-settings">TTS</div>,
}))

vi.mock('./STTSettings', () => ({
  STTSettings: () => <div data-testid="stt-settings">STT</div>,
}))

describe('VoiceSettings', () => {
  it('renders TTS and STT as top-aligned equal columns split at 1000px of container width', () => {
    const { container } = render(<VoiceSettings />)

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('@container', 'w-full', 'max-w-7xl')

    const ttsColumn = screen.getByTestId('tts-settings').parentElement as HTMLElement
    const sttColumn = screen.getByTestId('stt-settings').parentElement as HTMLElement
    expect(ttsColumn).toHaveClass('min-w-0')
    expect(sttColumn).toHaveClass('min-w-0')

    const layout = ttsColumn.parentElement as HTMLElement
    expect(layout).toHaveClass('grid', '@min-[1000px]:grid-cols-2', '@min-[1000px]:items-start')
    expect(layout.firstElementChild).toBe(ttsColumn)
  })
})
