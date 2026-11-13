import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionGoalRead } from '@opencode-manager/shared/opencode'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { SessionGoalBar } from './SessionGoalBar'

const goal = {
  id: 'goal_1',
  objective: 'Ship the feature',
  status: 'active',
  rounds: 3,
  maxRounds: 50,
  boot: 'boot_1',
  updatedAt: 1,
} as const

const goalRoute = (read: SessionGoalRead): FetchRoute => ({
  method: 'POST',
  path: '/api/opencode/api/rpc/opencode.goal/get',
  respond: () => ({ json: { output: read.goal } }),
})

const commandRoute = (respond?: FetchRoute['respond']): FetchRoute => ({
  method: 'POST',
  path: '/api/opencode/api/session/ses_1/command',
  respond: respond ?? (() => ({ status: 204 })),
})

function renderBar(read: SessionGoalRead, commandRespond?: FetchRoute['respond']) {
  return renderWithProviders(<SessionGoalBar sessionID="ses_1" directory="/repo" />, {
    auth: false,
    theme: false,
    tts: false,
    toaster: false,
    fetchRoutes: [goalRoute(read), commandRoute(commandRespond)],
  })
}

describe('SessionGoalBar', () => {
  it.each([
    ['an empty goal', { supported: true, goal: null }],
    ['an unsupported server', { supported: false }],
  ] as const)('renders nothing for %s', (_label, read) => {
    const { container } = renderBar(read)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the active goal and pauses or clears it through the goal command', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderBar({ supported: true, goal })

    expect(await screen.findByText('Goal active')).toBeInTheDocument()
    expect(screen.getByText('Round 3/50')).toBeInTheDocument()
    expect(screen.getByText('Ship the feature')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/command')?.body).toMatchObject({
        name: 'goal',
        text: 'pause',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/command')?.body).toMatchObject({
        name: 'goal',
        text: 'clear',
      }),
    )
  })

  it('resumes a paused goal and shows the pause reason', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderBar({
      supported: true,
      goal: { ...goal, status: 'paused', reason: 'Paused by the user' },
    })

    expect(await screen.findByText('Goal paused')).toBeInTheDocument()
    expect(screen.getByText('Paused by the user')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/command')?.body).toMatchObject({
        name: 'goal',
        text: 'resume',
      }),
    )
  })

  it('shows a completed goal with its reason and clears it', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderBar({
      supported: true,
      goal: { ...goal, status: 'complete', reason: 'Objective met' },
    })

    expect(await screen.findByText('Goal completed')).toBeInTheDocument()
    expect(screen.getByText('Objective met')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/ses_1/command')?.body).toMatchObject({
        name: 'goal',
        text: 'clear',
      }),
    )
  })

  it('disables the goal buttons while the command is pending', async () => {
    const user = userEvent.setup()
    const command = new Promise<FetchRouteResult>(() => undefined)
    renderBar({ supported: true, goal }, () => command)

    await user.click(await screen.findByRole('button', { name: 'Pause' }))

    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })
})
