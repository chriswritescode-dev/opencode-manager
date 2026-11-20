import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import type { FetchRoute } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { SessionUsageDialog } from './SessionUsageDialog'

const providerOptions = { auth: false, theme: false, tts: false } as const

function assistantStep(): SessionMessageAssistant {
  return {
    id: 'msg_1',
    type: 'assistant',
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude' },
    time: { created: 1000 },
    content: [],
    cost: 1,
    tokens: { input: 1000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function messagesRoute(): FetchRoute {
  return {
    method: 'GET',
    path: '/api/opencode/api/session/:sessionID/message',
    respond: () => ({ json: { data: [assistantStep()], cursor: {} } }),
  }
}

describe('SessionUsageDialog', () => {
  it('renders nothing when closed', () => {
    const result = renderWithProviders(
      <SessionUsageDialog open={false} onOpenChange={vi.fn()} sessionId="ses_1" />,
      { ...providerOptions, fetchRoutes: [messagesRoute()] },
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Session usage')).not.toBeInTheDocument()
    expect(screen.queryByText('Spend')).not.toBeInTheDocument()
    expect(
      result.fetchFake.findRequests('GET', '/api/opencode/api/session/ses_1/message'),
    ).toHaveLength(0)
  })

  it('shows the session usage title and summary when open', async () => {
    renderWithProviders(
      <SessionUsageDialog open onOpenChange={vi.fn()} sessionId="ses_1" />,
      { ...providerOptions, fetchRoutes: [messagesRoute()] },
    )

    expect(screen.getByText('Session usage')).toBeInTheDocument()
    expect(await screen.findByText('Spend')).toBeInTheDocument()
  })

  it('requests closing when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithProviders(
      <SessionUsageDialog open onOpenChange={onOpenChange} sessionId="ses_1" />,
      { ...providerOptions, fetchRoutes: [messagesRoute()] },
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('requests closing when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithProviders(
      <SessionUsageDialog open onOpenChange={onOpenChange} sessionId="ses_1" />,
      { ...providerOptions, fetchRoutes: [messagesRoute()] },
    )

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
