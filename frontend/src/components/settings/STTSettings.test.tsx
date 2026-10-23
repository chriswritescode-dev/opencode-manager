import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VOICE_PAUSE_STORAGE_KEY } from '@opencode-manager/shared/opencode'
import { STTSettings } from './STTSettings'
import { useSettings } from '@/hooks/useSettings'
import { useSTT } from '@/hooks/useSTT'
import { isWebRecognitionSupported, getAvailableLanguages } from '@/lib/webSpeechRecognizer'
import { createUseSettingsMock } from '@/test/test-utils'
import { DEFAULT_STT_CONFIG, DEFAULT_USER_PREFERENCES, type STTConfig, type UserPreferences } from '@/api/types/settings'

vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useSTT')
vi.mock('@/lib/webSpeechRecognizer')
vi.mock('@/api/stt', () => ({
  sttApi: {
    getModels: vi.fn().mockResolvedValue({ models: [] }),
    transcribe: vi.fn(),
  },
}))

function buildPreferences(stt: Partial<STTConfig> = {}): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    stt: { ...DEFAULT_STT_CONFIG, ...stt },
  }
}

function mockHooks(preferences: UserPreferences = buildPreferences({ enabled: true, provider: 'builtin' })) {
  vi.mocked(useSettings).mockReturnValue(createUseSettingsMock({ preferences }))
  vi.mocked(useSTT).mockReturnValue({
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    abortRecording: vi.fn(),
    isRecording: false,
    isProcessing: false,
    transcript: '',
    interimTranscript: '',
    error: null,
    isExternalProvider: preferences.stt?.provider === 'external',
  } as ReturnType<typeof useSTT>)
  vi.mocked(isWebRecognitionSupported).mockReturnValue(true)
  vi.mocked(getAvailableLanguages).mockReturnValue(['en-US'])
}

function getPauseSelect() {
  return screen.queryByRole('combobox', { name: 'Pause before sending' })
}

async function renderSettings(preferences?: UserPreferences) {
  if (preferences) {
    mockHooks(preferences)
  }
  const rendered = render(<STTSettings />)
  await act(async () => {})
  return rendered
}

describe('STTSettings pause before sending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockHooks()
  })

  it('shows the pause select for the enabled built-in provider', async () => {
    await renderSettings()

    expect(getPauseSelect()).toHaveValue('1.2 s')
  })

  it('hides the pause select for the external provider', async () => {
    await renderSettings(buildPreferences({ enabled: true, provider: 'external' }))

    expect(getPauseSelect()).not.toBeInTheDocument()
  })

  it('hides the pause select when STT is disabled', async () => {
    await renderSettings(buildPreferences({ enabled: false, provider: 'builtin' }))

    expect(getPauseSelect()).not.toBeInTheDocument()
  })

  it('writes the selected pause to device-local storage', async () => {
    const user = userEvent.setup()
    await renderSettings()

    const select = getPauseSelect()
    expect(select).toHaveValue('1.2 s')

    await user.click(select as HTMLElement)
    await user.click(screen.getByRole('option', { name: '3.0 s' }))

    expect(window.localStorage.getItem(VOICE_PAUSE_STORAGE_KEY)).toBe('3000')
    expect(getPauseSelect()).toHaveValue('3.0 s')
  })
})
