import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TalkModeOverlay } from './TalkModeOverlay'
import { TalkModeContext, type TalkModeContextValue } from '@/contexts/talk-mode-context'

const mockStop = vi.fn()

function createMockContext(overrides: Partial<TalkModeContextValue> = {}): TalkModeContextValue {
  return {
    state: 'off',
    error: null,
    userTranscript: null,
    agentResponse: null,
    userSpeaking: false,
    sessionID: null,
    start: vi.fn(),
    stop: mockStop,
    isEnabled: true,
    ...overrides,
  }
}

function renderWithContext(
  ui: React.ReactNode,
  contextValue: TalkModeContextValue
) {
  return render(
    <TalkModeContext.Provider value={contextValue}>
      {ui}
    </TalkModeContext.Provider>
  )
}

describe('TalkModeOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when state is off', () => {
    const context = createMockContext({ state: 'off', sessionID: 'test-session' })
    const { container } = renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(container.firstChild).toBeNull()
  })

  it('should not render for different session', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'other-session',
    })
    const { container } = renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(container.firstChild).toBeNull()
  })

  it('should render when active for this session', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Listening...')).toBeInTheDocument()
  })

  it('should show initializing status', () => {
    const context = createMockContext({
      state: 'initializing',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Starting...')).toBeInTheDocument()
  })

  it('should show thinking status', () => {
    const context = createMockContext({
      state: 'thinking',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Processing...')).toBeInTheDocument()
  })

  it('should show speaking status', () => {
    const context = createMockContext({
      state: 'speaking',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Speaking...')).toBeInTheDocument()
  })

  it('should show user transcript when available', () => {
    const context = createMockContext({
      state: 'thinking',
      sessionID: 'test-session',
      userTranscript: 'Hello, how are you?',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('You said:')).toBeInTheDocument()
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument()
  })

  it('should show agent response when available', () => {
    const context = createMockContext({
      state: 'speaking',
      sessionID: 'test-session',
      agentResponse: 'I am doing well, thank you!',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Agent:')).toBeInTheDocument()
    expect(screen.getByText('I am doing well, thank you!')).toBeInTheDocument()
  })

  it('should show error when in error state', () => {
    const context = createMockContext({
      state: 'error',
      sessionID: 'test-session',
      error: 'Microphone access denied',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Microphone access denied')).toBeInTheDocument()
  })

  it('should call stop when close button is clicked', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    const closeButton = screen.getByTitle('Exit Talk Mode (Escape)')
    await user.click(closeButton)

    expect(mockStop).toHaveBeenCalled()
  })

  it('should call stop when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    const backdrop = document.querySelector('.bg-black\\/20')
    expect(backdrop).toBeInTheDocument()
    
    await user.click(backdrop!)

    expect(mockStop).toHaveBeenCalled()
  })

  it('should show escape key hint', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    expect(screen.getByText('Esc')).toBeInTheDocument()
  })

  it('should render TalkModeOrb component', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
    })
    renderWithContext(
      <TalkModeOverlay sessionID="test-session" />,
      context
    )

    const orb = document.querySelector('.rounded-full')
    expect(orb).toBeInTheDocument()
  })
})
