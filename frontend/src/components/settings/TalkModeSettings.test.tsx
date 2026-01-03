import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TalkModeSettings } from './TalkModeSettings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'

const mockUpdateSettings = vi.fn()

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('TalkModeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render talk mode settings heading', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Talk Mode')).toBeInTheDocument()
  })

  it('should show enable toggle', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Enable Talk Mode')).toBeInTheDocument()
  })

  it('should disable toggle when STT is not enabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: false },
        tts: { enabled: true },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Requires both STT and TTS to be enabled first')).toBeInTheDocument()
    
    const toggle = screen.getByRole('switch')
    expect(toggle).toBeDisabled()
  })

  it('should disable toggle when TTS is not enabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: false },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    const toggle = screen.getByRole('switch')
    expect(toggle).toBeDisabled()
  })

  it('should enable toggle when both STT and TTS are enabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    const toggle = screen.getByRole('switch')
    expect(toggle).not.toBeDisabled()
  })

  it('should call updateSettings when toggle is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    const toggle = screen.getByRole('switch')
    await user.click(toggle)

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      talkMode: expect.objectContaining({
        enabled: true,
      }),
    })
  })

  it('should show sliders when talk mode is enabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: true,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Silence Detection')).toBeInTheDocument()
    expect(screen.getByText('800ms')).toBeInTheDocument()
    expect(screen.getByText('Minimum Speech Duration')).toBeInTheDocument()
    expect(screen.getByText('400ms')).toBeInTheDocument()
  })

  it('should show auto-interrupt toggle when enabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: true,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Auto-Interrupt (Barge-in)')).toBeInTheDocument()
  })

  it('should not show advanced settings when disabled', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: {
        stt: { enabled: true },
        tts: { enabled: true },
        talkMode: {
          enabled: false,
          silenceThresholdMs: 800,
          minSpeechMs: 400,
          autoInterrupt: true,
        },
      },
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.queryByText('Silence Detection')).not.toBeInTheDocument()
    expect(screen.queryByText('Auto-Interrupt (Barge-in)')).not.toBeInTheDocument()
  })

  it('should use default values when preferences are undefined', () => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: undefined,
      isLoading: false,
      updateSettings: mockUpdateSettings,
      updateSettingsAsync: vi.fn(),
      isUpdating: false,
    } as ReturnType<typeof useSettings>)

    render(<TalkModeSettings />, { wrapper: createWrapper() })

    expect(screen.getByText('Talk Mode')).toBeInTheDocument()
  })
})
