import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeRestartPendingNotice } from './OpenCodeRestartPendingNotice'

const {
  healthState,
} = vi.hoisted(() => ({
  healthState: { data: { opencode: 'healthy', opencodeRestartPending: false } as Record<string, unknown> },
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: () => healthState,
}))

const NOTICE_TEXT = 'Configuration changes are saved but require a server restart to take effect.'

interface NoticeProps {
  hasAutoPromptedRef: { current: boolean }
  openRestartPrompt: () => Promise<void>
  requestRestart: () => Promise<void>
  restartIsPending: boolean
}

function renderNotice(overrides: Partial<NoticeProps> = {}) {
  const props: NoticeProps = {
    hasAutoPromptedRef: { current: false },
    openRestartPrompt: vi.fn().mockResolvedValue(undefined),
    requestRestart: vi.fn().mockResolvedValue(undefined),
    restartIsPending: false,
    ...overrides,
  }
  const result = render(<OpenCodeRestartPendingNotice {...props} />)
  return { ...result, props }
}

describe('OpenCodeRestartPendingNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    healthState.data = { opencode: 'healthy', opencodeRestartPending: false }
  })

  it('renders nothing when no restart is pending', () => {
    const { props } = renderNotice()

    expect(screen.queryByText(NOTICE_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart now/i })).not.toBeInTheDocument()
    expect(props.openRestartPrompt).not.toHaveBeenCalled()
  })

  it('auto-opens the restart prompt when the pending flag flips to true', async () => {
    const { props, rerender } = renderNotice()
    expect(props.openRestartPrompt).not.toHaveBeenCalled()

    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    rerender(<OpenCodeRestartPendingNotice {...props} />)

    await waitFor(() => {
      expect(props.openRestartPrompt).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
  })

  it('does not re-prompt on re-render while the shared flag stays set', async () => {
    const { props, rerender } = renderNotice()

    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    rerender(<OpenCodeRestartPendingNotice {...props} />)

    await waitFor(() => {
      expect(props.openRestartPrompt).toHaveBeenCalledTimes(1)
    })

    rerender(<OpenCodeRestartPendingNotice {...props} />)

    expect(props.openRestartPrompt).toHaveBeenCalledTimes(1)
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
  })

  it('requests a restart via the notice button', async () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    const { props } = renderNotice()

    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /restart now/i }))

    expect(props.requestRestart).toHaveBeenCalledTimes(1)
  })

  it('disables the restart button while a restart is in flight', () => {
    healthState.data = { opencode: 'healthy', opencodeRestartPending: true }
    renderNotice({ restartIsPending: true })

    expect(screen.getByRole('button', { name: /restart now/i })).toBeDisabled()
  })
})
