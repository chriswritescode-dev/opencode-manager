import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VoiceConversationBar } from './VoiceConversationBar'
import type { VoiceConversationController } from '@/hooks/useVoiceConversation'

const buildController = (
  overrides: Partial<VoiceConversationController> = {},
): VoiceConversationController => ({
  isActive: true,
  phase: 'listening',
  label: 'Listening',
  hint: 'Speak what you want the agent to do',
  orbLabel: 'Send now',
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
})

const renderBar = (
  controller: VoiceConversationController,
  props: { hasPendingApproval?: boolean; onViewApproval?: () => void } = {},
) =>
  render(
    <VoiceConversationBar
      controller={controller}
      hasPendingApproval={props.hasPendingApproval ?? false}
      onViewApproval={props.onViewApproval ?? vi.fn()}
    />,
  )

describe('VoiceConversationBar', () => {
  it('shows the status, the hint and the live transcript', () => {
    renderBar(
      buildController({
        label: 'Listening',
        hint: 'Speak what you want the agent to do',
        liveTranscript: 'add a retry to the upload call',
      }),
    )

    expect(screen.getByText('Listening')).toBeInTheDocument()
    expect(screen.getByText('Speak what you want the agent to do')).toBeInTheDocument()
    expect(screen.getByText('add a retry to the upload call')).toBeInTheDocument()
  })

  it('hides the transcript when it is empty', () => {
    const { container } = renderBar(buildController({ liveTranscript: '' }))

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Listening')
    expect(container.querySelector('[dir="rtl"]')).toBeNull()
  })

  it('announces status changes through a polite live region', () => {
    renderBar(buildController({ label: 'Working' }))

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Working')
  })

  it('exits the conversation from the close control', async () => {
    const user = userEvent.setup()
    const controller = buildController()
    renderBar(controller)

    await user.click(screen.getByRole('button', { name: 'Exit voice conversation' }))

    expect(controller.exit).toHaveBeenCalledTimes(1)
    expect(controller.editInTextBox).not.toHaveBeenCalled()
  })

  it('swaps the close control for the edit control when the transcript can be kept', async () => {
    const user = userEvent.setup()
    const controller = buildController({
      canEditInTextBox: true,
      liveTranscript: 'half a sentence',
    })
    renderBar(controller)

    expect(screen.queryByRole('button', { name: 'Exit voice conversation' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit in text box' }))

    expect(controller.editInTextBox).toHaveBeenCalledTimes(1)
    expect(controller.exit).not.toHaveBeenCalled()
  })

  it('shows the stop control only while the agent can be stopped', async () => {
    const user = userEvent.setup()
    const { unmount } = renderBar(buildController({ canStopAgent: false }))

    expect(screen.queryByRole('button', { name: 'Stop the agent' })).toBeNull()
    unmount()

    const controller = buildController({ canStopAgent: true })
    renderBar(controller)
    await user.click(screen.getByRole('button', { name: 'Stop the agent' }))

    expect(controller.stopAgent).toHaveBeenCalledTimes(1)
  })

  it('shows the approval control instead of pause while the session waits for approval', async () => {
    const user = userEvent.setup()
    const onViewApproval = vi.fn()
    const controller = buildController({ phase: 'working', canStopAgent: true })
    renderBar(controller, { hasPendingApproval: true, onViewApproval })

    expect(screen.queryByRole('button', { name: 'Pause voice conversation' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View pending permission' }))

    expect(onViewApproval).toHaveBeenCalledTimes(1)
    expect(controller.pause).not.toHaveBeenCalled()
  })

  it('pauses the conversation outside the paused phase', async () => {
    const user = userEvent.setup()
    const controller = buildController({ phase: 'listening' })
    renderBar(controller)

    await user.click(screen.getByRole('button', { name: 'Pause voice conversation' }))

    expect(controller.pause).toHaveBeenCalledTimes(1)
    expect(controller.resume).not.toHaveBeenCalled()
  })

  it('resumes the conversation while paused', async () => {
    const user = userEvent.setup()
    const controller = buildController({ phase: 'paused', orbLabel: 'Resume voice conversation' })
    renderBar(controller)

    expect(screen.queryByRole('button', { name: 'Pause voice conversation' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Resume' }))

    expect(controller.resume).toHaveBeenCalledTimes(1)
  })

  it('continues a held reading while paused mid-reply', () => {
    renderBar(buildController({ phase: 'paused', hasHeldReading: true }))

    expect(screen.getByRole('button', { name: 'Continue reading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })

  it('sends the orb action for the current phase when the orb is pressed', async () => {
    const user = userEvent.setup()
    const controller = buildController({ phase: 'working', orbLabel: 'Add a message' })
    renderBar(controller)

    await user.click(screen.getByRole('button', { name: 'Add a message' }))

    expect(controller.tapOrb).toHaveBeenCalledTimes(1)
  })

  it('names the orb action for every phase', () => {
    const phases = [
      { phase: 'listening', orbLabel: 'Send now' },
      { phase: 'sending', orbLabel: 'Sending' },
      { phase: 'working', orbLabel: 'Add a message' },
      { phase: 'speaking', orbLabel: 'Skip reply' },
      { phase: 'recording', orbLabel: 'Send to queue' },
      { phase: 'paused', orbLabel: 'Resume voice conversation' },
      { phase: 'off', orbLabel: 'Voice conversation' },
    ] as const

    for (const { phase, orbLabel } of phases) {
      const { unmount } = renderBar(buildController({ phase, orbLabel }))

      expect(screen.getByRole('button', { name: orbLabel })).toBeInTheDocument()
      unmount()
    }
  })

  it('marks the orb busy while a turn is sent', () => {
    renderBar(buildController({ phase: 'sending', orbLabel: 'Sending' }))

    expect(screen.getByRole('button', { name: 'Sending' })).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the notice when there is one and keeps the reserved hint line empty', () => {
    renderBar(
      buildController({
        hint: '',
        notice: 'Turn on speech-to-text in Voice settings',
      }),
    )

    expect(screen.getByText('Turn on speech-to-text in Voice settings')).toBeInTheDocument()
  })
})
