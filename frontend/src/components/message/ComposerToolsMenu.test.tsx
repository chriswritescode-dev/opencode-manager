import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerToolsMenu } from './ComposerToolsMenu'
import { useSessionPermissionMode, useSetSessionPermissionMode } from '@/hooks/useSessionPermissionMode'
import type { SessionPermissionModeState } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useSessionPermissionMode')

const baseState: SessionPermissionModeState = {
  sessionId: 'ses_1',
  rootSessionId: 'ses_1',
  mode: 'ask',
  lockedReason: null,
}

function mockPermissionMode(state: Partial<SessionPermissionModeState> = {}, mutate = vi.fn()) {
  vi.mocked(useSessionPermissionMode).mockReturnValue({
    data: { ...baseState, ...state },
    isError: false,
  } as ReturnType<typeof useSessionPermissionMode>)
  vi.mocked(useSetSessionPermissionMode).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSetSessionPermissionMode>)
  return mutate
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof ComposerToolsMenu>> = {}) {
  const props = {
    sessionID: 'ses_1',
    directory: '/repo',
    goalArmed: false,
    goalDisabled: false,
    goalLabel: 'Goal mode: the next message becomes the objective',
    onToggleGoal: vi.fn(),
    onAttachFile: vi.fn(),
    ...overrides,
  }
  render(<ComposerToolsMenu {...props} />)
  return props
}

describe('ComposerToolsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not highlight the trigger when no tool is active', () => {
    mockPermissionMode()
    renderMenu()

    expect(screen.getByRole('button', { name: 'Composer options' })).not.toHaveClass('bg-highlight')
  })

  it('highlights the trigger while permissions accept everything', () => {
    mockPermissionMode({ mode: 'auto' })
    renderMenu()

    expect(screen.getByRole('button', { name: 'Composer options' })).toHaveClass('bg-highlight')
  })

  it('highlights the trigger while goal mode is armed', () => {
    mockPermissionMode()
    renderMenu({ goalArmed: true })

    expect(screen.getByRole('button', { name: 'Composer options' })).toHaveClass('bg-highlight')
  })

  it('switches permissions to accept everything', async () => {
    const user = userEvent.setup()
    const mutate = mockPermissionMode()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)

    expect(mutate).toHaveBeenCalledWith({ directory: '/repo', mode: 'auto' })
  })

  it('shows why permissions cannot be changed', async () => {
    const user = userEvent.setup()
    mockPermissionMode({ lockedReason: 'child' })
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Accept all permissions/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Inherited from parent session')
  })

  it('toggles goal mode', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    const props = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ }))

    expect(props.onToggleGoal).toHaveBeenCalledTimes(1)
  })

  it('shows why goal mode is unavailable', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    renderMenu({ goalDisabled: true, goalLabel: 'A goal is already active for this session' })

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    const item = await screen.findByRole('menuitemcheckbox', { name: /Goal mode/ })

    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('A goal is already active for this session')
  })

  it('opens the file picker', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    const props = renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Attach image or PDF' }))

    expect(props.onAttachFile).toHaveBeenCalledTimes(1)
  })

  it('omits the dictate item when onDictate is not provided', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await screen.findByRole('menuitem', { name: 'Attach image or PDF' })

    expect(screen.queryByRole('menuitem', { name: 'Dictate' })).not.toBeInTheDocument()
  })

  it('starts dictation when onDictate is provided', async () => {
    const user = userEvent.setup()
    mockPermissionMode()
    const onDictate = vi.fn()
    renderMenu({ onDictate })

    await user.click(screen.getByRole('button', { name: 'Composer options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Dictate' }))

    expect(onDictate).toHaveBeenCalledTimes(1)
  })
})
