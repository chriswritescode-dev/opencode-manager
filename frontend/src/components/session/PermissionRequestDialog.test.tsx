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
    expect(screen.getByText('rm -rf node_modules')).toBeInTheDocument()
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
