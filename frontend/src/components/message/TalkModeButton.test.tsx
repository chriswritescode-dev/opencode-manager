import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TalkModeButton } from './TalkModeButton'
import { TalkModeContext, type TalkModeContextValue } from '@/contexts/talk-mode-context'

const mockStart = vi.fn()
const mockStop = vi.fn()

function createMockContext(overrides: Partial<TalkModeContextValue> = {}): TalkModeContextValue {
  return {
    state: 'off',
    error: null,
    userTranscript: null,
    agentResponse: null,
    userSpeaking: false,
    sessionID: null,
    start: mockStart,
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

describe('TalkModeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when talk mode is disabled', () => {
    const context = createMockContext({ isEnabled: false })
    const { container } = renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    expect(container.firstChild).toBeNull()
  })

  it('should render when talk mode is enabled', () => {
    const context = createMockContext({ isEnabled: true })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('should show headphones icon when inactive', () => {
    const context = createMockContext({ state: 'off', isEnabled: true })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Start Talk Mode')
  })

  it('should show headphones-off icon when active for this session', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
      isEnabled: true,
    })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Exit Talk Mode')
  })

  it('should call start when clicked while inactive', async () => {
    const user = userEvent.setup()
    const context = createMockContext({ state: 'off', isEnabled: true })
    renderWithContext(
      <TalkModeButton
        sessionID="test-session"
        opcodeUrl="http://localhost"
        directory="/test/dir"
      />,
      context
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(mockStart).toHaveBeenCalledWith('test-session', 'http://localhost', '/test/dir')
  })

  it('should call stop when clicked while active', async () => {
    const user = userEvent.setup()
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
      isEnabled: true,
    })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(mockStop).toHaveBeenCalled()
  })

  it('should be disabled when active in another session', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'other-session',
      isEnabled: true,
    })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Talk Mode active in another session')
  })

  it('should show loading state during initialization', () => {
    const context = createMockContext({
      state: 'initializing',
      sessionID: 'test-session',
      isEnabled: true,
    })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should apply disabled prop', () => {
    const context = createMockContext({ isEnabled: true })
    renderWithContext(
      <TalkModeButton
        sessionID="test-session"
        opcodeUrl="http://localhost"
        disabled={true}
      />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should apply custom className', () => {
    const context = createMockContext({ isEnabled: true })
    renderWithContext(
      <TalkModeButton
        sessionID="test-session"
        opcodeUrl="http://localhost"
        className="custom-class"
      />,
      context
    )

    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
  })

  it('should have active styling when talk mode is active for this session', () => {
    const context = createMockContext({
      state: 'listening',
      sessionID: 'test-session',
      isEnabled: true,
    })
    renderWithContext(
      <TalkModeButton sessionID="test-session" opcodeUrl="http://localhost" />,
      context
    )

    const button = screen.getByRole('button')
    expect(button.className).toContain('from-purple-500')
  })
})
