import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionModeToggle } from './PermissionModeToggle'
import { useSessionPermissionMode, useSetSessionPermissionMode } from '@/hooks/useSessionPermissionMode'
import type { SessionPermissionModeState } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useSessionPermissionMode')

const baseState: SessionPermissionModeState = {
  sessionId: 'ses_1',
  rootSessionId: 'ses_1',
  mode: 'ask',
  lockedReason: null,
}

function mockHooks(overrides: {
  data?: SessionPermissionModeState | undefined
  state?: Partial<SessionPermissionModeState>
  mutate?: ReturnType<typeof vi.fn>
  isPending?: boolean
  isError?: boolean
} = {}) {
  const data = 'data' in overrides ? overrides.data : { ...baseState, ...overrides.state }
  vi.mocked(useSessionPermissionMode).mockReturnValue({
    data,
    isError: overrides.isError ?? false,
  } as ReturnType<typeof useSessionPermissionMode>)
  vi.mocked(useSetSessionPermissionMode).mockReturnValue({
    mutate: overrides.mutate ?? vi.fn(),
    isPending: overrides.isPending ?? false,
  } as unknown as ReturnType<typeof useSetSessionPermissionMode>)
}

describe('PermissionModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the ask state', () => {
    mockHooks()
    render(<PermissionModeToggle sessionID="ses_1" directory="/repo" />)

    expect(screen.getByRole('button', { name: 'Permissions: ask every time' })).toBeEnabled()
  })

  it('switches to accept-everything with the directory when clicked', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockHooks({ mutate })
    render(<PermissionModeToggle sessionID="ses_1" directory="/repo" />)

    await user.click(screen.getByRole('button', { name: 'Permissions: ask every time' }))

    expect(mutate).toHaveBeenCalledWith({ directory: '/repo', mode: 'auto' })
  })

  it('switches back to ask when already accepting everything', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockHooks({ state: { mode: 'auto' }, mutate })
    render(<PermissionModeToggle sessionID="ses_1" directory="/repo" />)

    await user.click(screen.getByRole('button', { name: 'Permissions: accept everything' }))

    expect(mutate).toHaveBeenCalledWith({ directory: '/repo', mode: 'ask' })
  })

  it('is disabled and labelled as locked for child sessions', () => {
    mockHooks({ state: { lockedReason: 'child', mode: 'auto' } })
    render(<PermissionModeToggle sessionID="ses_child" directory="/repo" />)

    const button = screen.getByRole('button', { name: 'Inherited from parent session' })
    expect(button).toBeDisabled()
  })

  it('is disabled and labelled for schedule-run sessions', () => {
    mockHooks({ state: { lockedReason: 'schedule', mode: 'ask' } })
    render(<PermissionModeToggle sessionID="ses_sched" directory="/repo" />)

    const button = screen.getByRole('button', { name: "Scheduled runs use the schedule's permission configuration" })
    expect(button).toBeDisabled()
  })

  it('cannot mutate while the mode read is still loading', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockHooks({ data: undefined, mutate })
    render(<PermissionModeToggle sessionID="ses_1" directory="/repo" />)

    const button = screen.getByRole('button', { name: 'Permissions: loading' })
    expect(button).toBeDisabled()

    await user.click(button)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('cannot mutate and reports unavailable when the mode read failed', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockHooks({ data: undefined, isError: true, mutate })
    render(<PermissionModeToggle sessionID="ses_1" directory="/repo" />)

    const button = screen.getByRole('button', { name: 'Permissions: unavailable' })
    expect(button).toBeDisabled()

    await user.click(button)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('switches a loaded auto mode back to ask when clicked', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockHooks({ data: { ...baseState, mode: 'auto' }, mutate })
    render(<PermissionModeToggle sessionID="ses_1" directory="/repo" />)

    await user.click(screen.getByRole('button', { name: 'Permissions: accept everything' }))

    expect(mutate).toHaveBeenCalledWith({ directory: '/repo', mode: 'ask' })
  })
})
