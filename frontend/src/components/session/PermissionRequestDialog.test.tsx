import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-manager/shared/opencode'
import { PermissionRequestDialog } from './PermissionRequestDialog'

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
  },
}))

const permission: PermissionRequest = {
  id: 'perm-1',
  sessionID: 'session-1',
  action: 'shell',
  resources: ['rm -rf node_modules'],
  save: ['rm *'],
  metadata: {},
}

const secondPermission: PermissionRequest = {
  ...permission,
  id: 'perm-2',
  resources: ['git push origin main'],
}

describe('PermissionRequestDialog', () => {
  it('renders the action label and command detail', () => {
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={vi.fn()} />)

    expect(screen.getByText('Run Command')).toBeInTheDocument()
    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText('rm -rf node_modules')).toBeInTheDocument()
  })

  it('phrases the allow question in lowercase while preserving acronyms', () => {
    const { unmount } = render(
      <PermissionRequestDialog permission={permission} pendingCount={1} onRespond={vi.fn()} />,
    )
    expect(screen.getByText('Allow run command?')).toBeInTheDocument()
    unmount()

    render(
      <PermissionRequestDialog
        permission={{ ...permission, action: 'webfetch', resources: [], metadata: { url: 'https://example.com' } }}
        pendingCount={1}
        onRespond={vi.fn()}
      />,
    )
    expect(screen.getByText('Allow fetch URL?')).toBeInTheDocument()
  })

  it('labels multiple shell resources as commands', () => {
    render(
      <PermissionRequestDialog
        permission={{ ...permission, resources: ['git status', 'git push origin main'] }}
        pendingCount={1}
        onRespond={vi.fn()}
      />,
    )

    expect(screen.getByText('Commands')).toBeInTheDocument()
    expect(screen.getByText(/git status/)).toBeInTheDocument()
    expect(screen.getByText(/git push origin main/)).toBeInTheDocument()
  })

  it('shows the request message when present', () => {
    render(
      <PermissionRequestDialog
        permission={{ ...permission, message: 'This command modifies tracked files.' }}
        pendingCount={1}
        onRespond={vi.fn()}
      />,
    )

    expect(screen.getByText('This command modifies tracked files.')).toBeInTheDocument()
  })

  it('describes a wildcard always scope', () => {
    render(
      <PermissionRequestDialog
        permission={{ ...permission, save: ['*'] }}
        pendingCount={1}
        onRespond={vi.fn()}
      />,
    )

    expect(screen.getByText('This will always allow run command for this project.')).toBeInTheDocument()
  })

  it('lists the patterns an always decision approves', () => {
    render(
      <PermissionRequestDialog
        permission={{ ...permission, save: ['printf *', 'echo *'] }}
        pendingCount={1}
        onRespond={vi.fn()}
      />,
    )

    expect(
      screen.getByText('This will always allow the following patterns for this project.'),
    ).toBeInTheDocument()
    expect(screen.getByText('printf *')).toBeInTheDocument()
    expect(screen.getByText('echo *')).toBeInTheDocument()
  })

  it('omits the always option when no save patterns are provided', () => {
    render(
      <PermissionRequestDialog
        permission={{ ...permission, save: undefined }}
        pendingCount={1}
        onRespond={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Allow Always' })).not.toBeInTheDocument()
    expect(screen.queryByText(/This will always allow/)).not.toBeInTheDocument()
  })

  it('renders an open session control that triggers the handler', async () => {
    const onOpenSession = vi.fn()
    render(
      <PermissionRequestDialog
        permission={permission}
        pendingCount={1}
        onRespond={vi.fn()}
        onOpenSession={onOpenSession}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Open session' }))

    expect(onOpenSession).toHaveBeenCalledTimes(1)
  })

  it('omits the open session control without a handler', () => {
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Open session' })).not.toBeInTheDocument()
  })

  it('focuses the allow action instead of the optional reason field', async () => {
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={vi.fn()} />)

    const allowOnce = screen.getByRole('button', { name: 'Allow Once' })
    await waitFor(() => expect(allowOnce).toHaveFocus())
    expect(screen.getByLabelText('Reason (optional)')).not.toHaveFocus()
  })

  it('replies with the selected decision for the permission request', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={onRespond} />)

    await userEvent.click(screen.getByRole('button', { name: 'Allow Once' }))

    expect(onRespond).toHaveBeenCalledWith('perm-1', 'session-1', 'once', undefined)
  })

  it('forwards an optional rejection reason when denying', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={onRespond} />)

    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'not allowed')
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith('perm-1', 'session-1', 'reject', 'not allowed'),
    )
  })

  it('denies without a reason when none is supplied', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={onRespond} />)

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledWith('perm-1', 'session-1', 'reject', undefined))
  })

  it('omits the reason for allow decisions', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={onRespond} />)

    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'not allowed')
    await userEvent.click(screen.getByRole('button', { name: 'Allow Always' }))

    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith('perm-1', 'session-1', 'always', undefined),
    )
  })

  it('resets the rejection reason when the permission identity changes', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <PermissionRequestDialog permission={permission} pendingCount={2} onRespond={onRespond} />,
    )

    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'not allowed')
    expect((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value).toBe('not allowed')

    rerender(<PermissionRequestDialog permission={secondPermission} pendingCount={1} onRespond={onRespond} />)

    await waitFor(() =>
      expect((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value).toBe(''),
    )
  })

  it('retains the rejection reason when the request fails', async () => {
    const onRespond = vi.fn().mockRejectedValueOnce(new Error('network'))
    render(<PermissionRequestDialog permission={permission} pendingCount={1} onRespond={onRespond} />)

    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'not allowed')
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value).toBe('not allowed')
  })
})
