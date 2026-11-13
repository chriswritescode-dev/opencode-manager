import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import type { ReactNode } from 'react'
import type { useSettings } from '@/hooks/useSettings'
import type { VoiceConversationController } from '@/hooks/useVoiceConversation'
import type { CommandActions } from '@/lib/builtinCommands'
import { LocationCatcher } from './test-components'
import { installMatchMedia } from './browserFakes'

export function createVoiceConversationControllerMock(
  overrides: Partial<VoiceConversationController> = {},
): VoiceConversationController {
  return {
    isActive: false,
    phase: 'off',
    label: 'Voice conversation',
    hint: '',
    orbLabel: 'Voice conversation',
    liveTranscript: '',
    canEditInTextBox: false,
    canStopAgent: false,
    hasHeldReading: false,
    isEndpointing: false,
    notice: null,
    start: vi.fn(),
    exit: vi.fn(),
    editInTextBox: vi.fn(),
    tapOrb: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stopAgent: vi.fn(),
    ...overrides,
  }
}

export function createCommandActionsMock(): CommandActions {
  return {
    showSessions: vi.fn(),
    showModels: vi.fn(),
    newSession: vi.fn(),
    toggleDetails: vi.fn(),
    exportSession: vi.fn(),
    copyTranscript: vi.fn(),
    compact: vi.fn(),
    askSideQuestion: vi.fn(),
    renameSession: vi.fn(),
    forkSession: vi.fn(),
    jumpToMessage: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cycleAgent: vi.fn(),
    cycleVariant: vi.fn(),
    showMcp: vi.fn(),
    showSkills: vi.fn(),
    showSettings: vi.fn(),
    connectProvider: vi.fn(),
    showWalkthrough: vi.fn(),
  }
}

export function createUseSettingsMock(
  overrides: Partial<ReturnType<typeof useSettings>> = {},
): ReturnType<typeof useSettings> {
  return {
    settings: undefined,
    preferences: undefined,
    isLoading: false,
    error: null,
    updateSettings: vi.fn(),
    updateSettingsAsync: vi.fn(),
    resetSettings: vi.fn(),
    isUpdating: false,
    isResetting: false,
    ...overrides,
  }
}

export function stubMatchMedia(matches: boolean) {
  const fake = installMatchMedia(matches)
  return { mediaQueryList: fake.mediaQueryList, listeners: fake.listeners }
}

export function createRouterWrapper(initialEntries?: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  }
}

export function renderHookWithRouter<T>(renderFn: () => T, initialEntries?: string[]) {
  return renderHook(renderFn, { wrapper: createRouterWrapper(initialEntries) })
}

export function renderHookWithRouterAndLocation<T>(renderFn: () => T, initialEntries?: string[]) {
  const capturedSearch = { current: '' }
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <LocationCatcher capturedSearch={capturedSearch} />
        {children}
      </MemoryRouter>
    )
  }
  const rendered = renderHook(renderFn, { wrapper })
  return { ...rendered, capturedSearch }
}
