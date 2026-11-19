import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionReply, PermissionRequest } from '@opencode-manager/shared/opencode'
import { renderWithProviders } from '@/test/render'
import { PermissionRequestDialog } from './PermissionRequestDialog'

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

function renderDialog(overrides: Partial<Parameters<typeof PermissionRequestDialog>[0]> = {}) {
  const onRespond = overrides.onRespond ?? vi.fn<
    (permissionID: string, sessionID: string, response: PermissionReply, message?: string) => Promise<void>
  >(() => Promise.resolve())
  const result = renderWithProviders(
    <PermissionRequestDialog permission={permission} pendingCount={1} onRespond={onRespond} {...overrides} />,
  )
  return { ...result, onRespond }
}

describe('PermissionRequestDialog', () => {
  it('renders the action label and command detail', () => {
    renderDialog()

    expect(screen.getByText('Run Command')).toBeInTheDocument()
    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText('rm -rf node_modules')).toBeInTheDocument()
  })

  it.each([
    ['shell', 'Allow run command?'],
    ['webfetch', 'Allow fetch URL?'],
  ] as const)('phrases the allow question in lowercase for %s', (action, question) => {
    renderDialog({ permission: { ...permission, action, resources: [], metadata: { url: 'https://example.com' } } })

    expect(screen.getByText(question)).toBeInTheDocument()
  })

  it('labels multiple shell resources as commands', () => {
    renderDialog({ permission: { ...permission, resources: ['git status', 'git push origin main'] } })

    expect(screen.getByText('Commands')).toBeInTheDocument()
    expect(screen.getByText(/git status/)).toBeInTheDocument()
    expect(screen.getByText(/git push origin main/)).toBeInTheDocument()
  })

  it('shows the request message when present', () => {
    renderDialog({ permission: { ...permission, message: 'This command modifies tracked files.' } })

    expect(screen.getByText('This command modifies tracked files.')).toBeInTheDocument()
  })

  it('describes a wildcard always scope', () => {
    renderDialog({ permission: { ...permission, save: ['*'] } })

    expect(screen.getByText('This will always allow run command for this project.')).toBeInTheDocument()
  })

  it('lists the patterns an always decision approves', () => {
    renderDialog({ permission: { ...permission, save: ['printf *', 'echo *'] } })

    expect(
      screen.getByText('This will always allow the following patterns for this project.'),
    ).toBeInTheDocument()
    expect(screen.getByText('printf *')).toBeInTheDocument()
    expect(screen.getByText('echo *')).toBeInTheDocument()
  })

  it('omits the always option when no save patterns are provided', () => {
    renderDialog({ permission: { ...permission, save: undefined } })

    expect(screen.queryByRole('button', { name: 'Allow Always' })).not.toBeInTheDocument()
    expect(screen.queryByText(/This will always allow/)).not.toBeInTheDocument()
  })

  it('renders an open session control that triggers the handler', async () => {
    const user = userEvent.setup()
    const onOpenSession = vi.fn()
    renderDialog({ onOpenSession })

    await user.click(screen.getByRole('button', { name: 'Open session' }))

    expect(onOpenSession).toHaveBeenCalledTimes(1)
  })

  it('omits the open session control without a handler', () => {
    renderDialog()

    expect(screen.queryByRole('button', { name: 'Open session' })).not.toBeInTheDocument()
  })

  it('focuses the allow action instead of the optional reason field', async () => {
    renderDialog()

    const allowOnce = screen.getByRole('button', { name: 'Allow Once' })
    await waitFor(() => expect(allowOnce).toHaveFocus())
    expect(screen.getByLabelText('Reason (optional)')).not.toHaveFocus()
  })

  it.each([
    ['Allow Once', undefined, 'once', undefined],
    ['Allow Always', 'not allowed', 'always', undefined],
    ['Deny', 'not allowed', 'reject', 'not allowed'],
    ['Deny', undefined, 'reject', undefined],
  ] as const)(
    'replies with %s and the expected reason',
    async (button, typedReason, response, reason) => {
      const user = userEvent.setup()
      const { onRespond } = renderDialog()

      if (typedReason) await user.type(screen.getByLabelText('Reason (optional)'), typedReason)
      await user.click(screen.getByRole('button', { name: button }))

      await waitFor(() =>
        expect(onRespond).toHaveBeenCalledWith('perm-1', 'session-1', response, reason),
      )
    },
  )

  it('resets the rejection reason when the permission identity changes', async () => {
    const user = userEvent.setup()

    function Host() {
      const [current, setCurrent] = useState(permission)
      return (
        <>
          <button type="button" onClick={() => setCurrent(secondPermission)}>
            next permission
          </button>
          <PermissionRequestDialog
            permission={current}
            pendingCount={current.id === 'perm-1' ? 2 : 1}
            onRespond={vi.fn(() => Promise.resolve())}
          />
        </>
      )
    }

    renderWithProviders(<Host />)

    await user.type(screen.getByLabelText('Reason (optional)'), 'not allowed')
    expect(screen.getByLabelText('Reason (optional)')).toHaveValue('not allowed')

    fireEvent.click(screen.getByText('next permission'))

    await waitFor(() => expect(screen.getByLabelText('Reason (optional)')).toHaveValue(''))
  })

  it('retains the rejection reason and reports the failure', async () => {
    const user = userEvent.setup()
    const { onRespond } = renderDialog({ onRespond: vi.fn(() => Promise.reject(new Error('network'))) })

    await user.type(screen.getByLabelText('Reason (optional)'), 'not allowed')
    await user.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Reason (optional)')).toHaveValue('not allowed')
    expect(
      await screen.findByText('Failed to respond to permission. Please try again.'),
    ).toBeInTheDocument()
  })
})
