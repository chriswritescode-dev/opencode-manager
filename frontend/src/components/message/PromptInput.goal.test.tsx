import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CommandInfo } from '@opencode-manager/shared/opencode'
import type { SessionGoalRead } from '@opencode-manager/shared/opencode'
import { promptTextarea, renderPromptInput } from '@/test/promptInput'
import type { FetchRouteResult } from '@/test/fetchFake'

const GOAL_BUTTON = 'Goal mode: the next message becomes the objective'
const OPEN_GOAL_BUTTON = 'A goal is already active for this session'
const UNSUPPORTED_GOAL_BUTTON = "This server's OpenCode has no goals"

const idleGoal: SessionGoalRead = { supported: true, goal: null }

const openGoal: SessionGoalRead = {
  supported: true,
  goal: {
    id: 'goal_1',
    objective: 'Ship the feature',
    status: 'active',
    rounds: 1,
    maxRounds: 50,
    boot: 'boot_1',
    updatedAt: 1,
  },
}

const reviewCommand: CommandInfo = { name: 'review', description: 'Review the diff' }

const goalCommandBody = {
  name: 'goal',
  text: 'Ship the feature',
  files: [],
  agents: [],
  skills: [],
}

function deferredCommand() {
  let resolve: (result: FetchRouteResult) => void = () => {}
  const respond = () => new Promise<FetchRouteResult>((settle) => {
    resolve = settle
  })
  return { respond, resolve: (result: FetchRouteResult) => resolve(result) }
}

async function armGoal() {
  fireEvent.click(await screen.findByRole('button', { name: GOAL_BUTTON }))
}

describe('PromptInput goal mode', () => {
  it('runs the goal command with the message objective instead of sending the prompt', async () => {
    const { fetchFake } = await renderPromptInput({ goal: idleGoal, sessionAgent: 'build' })

    fireEvent.change(promptTextarea(), { target: { value: 'Ship the feature' } })
    await armGoal()
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')?.body).toMatchObject(goalCommandBody)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeUndefined()
  })

  it('runs the goal command instead of queueing when the session is busy', async () => {
    const { fetchFake } = await renderPromptInput({ goal: idleGoal, sessionAgent: 'build', isStreamingResponse: true })

    fireEvent.change(promptTextarea(), { target: { value: 'Ship the feature' } })
    await armGoal()
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')?.body).toMatchObject(goalCommandBody)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeUndefined()
  })

  it('does not send the prompt when the goal command is rejected', async () => {
    const { fetchFake } = await renderPromptInput({
      goal: idleGoal,
      runCommand: () => ({ status: 400, json: { error: 'goal command failed' } }),
    })

    fireEvent.change(promptTextarea(), { target: { value: 'Ship the feature' } })
    await armGoal()
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeUndefined()
    expect(promptTextarea()).toHaveValue('Ship the feature')
  })

  it('passes the selected model to the goal selection sync', async () => {
    const { fetchFake } = await renderPromptInput({ goal: idleGoal, sessionAgent: 'build' })

    fireEvent.change(promptTextarea(), { target: { value: 'Ship the feature' } })
    await armGoal()
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/model')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/model')?.body).toMatchObject({
      model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
    })
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')?.body).toMatchObject(goalCommandBody)
  })

  it('keeps the image draft and warns when an armed goal has no objective', async () => {
    const { container, fetchFake } = await renderPromptInput({ goal: idleGoal })

    const fileInput = container.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('file input is missing')
    fireEvent.change(fileInput, { target: { files: [new File(['img'], 'pic.png', { type: 'image/png' })] } })
    await screen.findByText('pic.png')

    await armGoal()
    fireEvent.click(screen.getByTitle('Send'))

    expect(await screen.findByText('Enter an objective for the goal')).toBeInTheDocument()
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeUndefined()
    expect(screen.getByText('pic.png')).toBeInTheDocument()
  })

  it('keeps a whitespace-only draft and warns when an armed goal has no objective', async () => {
    const { fetchFake } = await renderPromptInput({ goal: idleGoal })

    fireEvent.change(promptTextarea(), { target: { value: '   ' } })
    await armGoal()
    fireEvent.keyDown(promptTextarea(), { key: 'Enter', ctrlKey: true })

    expect(await screen.findByText('Enter an objective for the goal')).toBeInTheDocument()
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
    expect(promptTextarea()).toHaveValue('   ')
  })

  it('sends the prompt without the goal command when the goal mode was not armed', async () => {
    const { fetchFake } = await renderPromptInput({ goal: idleGoal })

    fireEvent.change(promptTextarea(), { target: { value: 'Just a message' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
  })

  it('does not run the goal command again while it is still pending', async () => {
    const command = deferredCommand()
    const { fetchFake } = await renderPromptInput({ goal: idleGoal, isStreamingResponse: true, runCommand: command.respond })

    fireEvent.change(promptTextarea(), { target: { value: 'Ship the feature' } })
    await armGoal()
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/command')).toHaveLength(1))

    fireEvent.click(screen.getByTitle('Queue message'))

    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/command')).toHaveLength(1)
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeUndefined()

    await act(async () => {
      command.resolve({ status: 204 })
    })
  })

  it('sends an exact slash command without running the goal command', async () => {
    const { fetchFake } = await renderPromptInput({ goal: idleGoal, commands: [reviewCommand], isStreamingResponse: true })

    fireEvent.change(promptTextarea(), { target: { value: '/review the diff' } })
    await armGoal()
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
      text: '/review the diff',
      delivery: 'queue',
    })
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeUndefined()
  })

  it('disables goal mode when the server has no goal support', async () => {
    await renderPromptInput({ goal: { supported: false } })

    expect(await screen.findByRole('button', { name: UNSUPPORTED_GOAL_BUTTON })).toBeDisabled()
  })

  it('disables goal mode while a goal is already active', async () => {
    await renderPromptInput({ goal: openGoal })

    expect(await screen.findByRole('button', { name: OPEN_GOAL_BUTTON })).toBeDisabled()
  })

  it('keeps goal mode enabled on child sessions', async () => {
    await renderPromptInput({
      goal: idleGoal,
      permissionMode: { sessionId: 'test-session', rootSessionId: 'test-session', mode: 'ask', lockedReason: 'child' },
    })

    expect(await screen.findByRole('button', { name: GOAL_BUTTON })).toBeEnabled()
  })

  it('keeps permission and goal toggles inline on desktop', async () => {
    await renderPromptInput({ goal: idleGoal })

    expect(await screen.findByRole('button', { name: GOAL_BUTTON })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Permissions:/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Composer options' })).not.toBeInTheDocument()
  })

  it('moves permission and goal toggles into the composer options menu on mobile', async () => {
    await renderPromptInput({ goal: idleGoal, mobile: true })

    const menu = await screen.findByRole('button', { name: 'Composer options' })
    expect(menu).toHaveAttribute('title', 'Composer options')
    expect(screen.queryByRole('button', { name: GOAL_BUTTON })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Permissions:/ })).not.toBeInTheDocument()
  })

  it('runs the goal command when armed from the mobile composer options menu', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderPromptInput({ goal: idleGoal, mobile: true })

    fireEvent.change(promptTextarea(), { target: { value: 'Ship the feature' } })
    await user.click(await screen.findByRole('button', { name: 'Composer options' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ }))
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/command')?.body).toMatchObject(goalCommandBody)
  })

  it('passes the open goal state to the mobile composer options menu', async () => {
    const user = userEvent.setup()
    await renderPromptInput({ goal: openGoal, mobile: true })

    await user.click(await screen.findByRole('button', { name: 'Composer options' }))

    expect(await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ })).toHaveAttribute('aria-disabled', 'true')
  })
})
