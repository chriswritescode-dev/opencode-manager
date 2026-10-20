import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildOpenCodeServerLink, OPENCODE_SERVER_LINK_VERSION, type OpenCodeServer, type OpenCodeServerTestResult } from '@opencode-manager/shared/schemas'
import { OpenCodeServerDialog, type OpenCodeServerFormValues } from './OpenCodeServerDialog'

const testResult: OpenCodeServerTestResult = {
  ok: true,
  version: '2.0.15',
  versionSupported: true,
  error: null,
}

const pairingLink = buildOpenCodeServerLink({
  kind: 'opencode',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  pairing: { pairUrl: 'https://kitchen.example.com/pair', code: 'pairing-code-0123456789' },
})

const savedServer: OpenCodeServer = {
  id: 'srv_1',
  name: 'Office',
  baseUrl: 'https://office.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const originChangeWarning = 'Changing the server address requires re-entering the password or pairing again.'

function renderDialog(options: {
  server?: OpenCodeServer | null
  onSubmit?: (values: OpenCodeServerFormValues) => Promise<void>
} = {}) {
  const onSubmit = vi.fn(options.onSubmit ?? (async () => {}))
  const onTest = vi.fn(async () => testResult)
  const onOpenChange = vi.fn()
  render(
    <OpenCodeServerDialog
      open
      onOpenChange={onOpenChange}
      server={options.server}
      onSubmit={onSubmit}
      onTest={onTest}
    />,
  )
  return { onSubmit, onTest, onOpenChange }
}

describe('OpenCodeServerDialog', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  it('prefills name and URL from a pasted pairing link and sends pairing on save', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog()

    await user.type(screen.getByLabelText('Pairing link'), pairingLink)
    await user.click(screen.getByRole('button', { name: 'Use link' }))

    expect(screen.getByText('Pairing with Kitchen')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Kitchen')
    expect(screen.getByLabelText('URL')).toHaveValue('https://kitchen.example.com')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Kitchen',
      baseUrl: 'https://kitchen.example.com',
      password: '',
      pairing: { pairUrl: 'https://kitchen.example.com/pair', code: 'pairing-code-0123456789' },
    })
  })

  it('rejects an invalid pairing link with an inline error', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText('Pairing link'), 'not-a-pairing-link')
    await user.click(screen.getByRole('button', { name: 'Use link' }))

    expect(screen.getByRole('alert')).toHaveTextContent('That is not a valid OpenCode pairing link.')
    expect(screen.queryByText(/Pairing with/)).not.toBeInTheDocument()
  })

  it('explains that a pairing link from an unsupported version cannot be used', async () => {
    const user = userEvent.setup()
    renderDialog()

    const outdated = pairingLink.replace(`v=${OPENCODE_SERVER_LINK_VERSION}`, 'v=1')
    await user.type(screen.getByLabelText('Pairing link'), outdated)
    await user.click(screen.getByRole('button', { name: 'Use link' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      `This pairing link uses link version 1, but this Manager expects version ${OPENCODE_SERVER_LINK_VERSION}. Update the Manager or the ocm CLI and generate a new QR code.`,
    )
    expect(screen.queryByText(/Pairing with/)).not.toBeInTheDocument()
  })

  it('sends clearPassword when the stored password is explicitly cleared', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog({ server: savedServer })

    expect(screen.getByLabelText('Password')).toHaveValue('')

    await user.click(screen.getByLabelText('Clear stored password'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Office',
      baseUrl: 'https://office.example.com',
      clearPassword: true,
      pairing: null,
    })
  })

  it('shows the connection test result from the parent', async () => {
    const user = userEvent.setup()
    const { onTest } = renderDialog({ server: savedServer })

    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    await waitFor(() => expect(onTest).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Connected — OpenCode 2.0.15')).toBeInTheDocument()
    expect(screen.getByText('Supported')).toBeInTheDocument()
  })

  it('warns that changing the server origin requires credentials', async () => {
    const user = userEvent.setup()
    renderDialog({ server: savedServer })

    expect(screen.queryByText(originChangeWarning)).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'https://relocated.example.com')

    expect(screen.getByText(originChangeWarning)).toBeInTheDocument()
  })

  it('does not warn for a same-origin address change', async () => {
    const user = userEvent.setup()
    renderDialog({ server: savedServer })

    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'https://office.example.com/api')

    expect(screen.queryByText(originChangeWarning)).not.toBeInTheDocument()
  })

  it('does not warn once a password is entered for the new origin', async () => {
    const user = userEvent.setup()
    renderDialog({ server: savedServer })

    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'https://relocated.example.com')
    await user.type(screen.getByLabelText('Password'), 'new-password')

    expect(screen.queryByText(originChangeWarning)).not.toBeInTheDocument()
  })

  it('does not warn about an origin change when no password is stored', async () => {
    const user = userEvent.setup()
    renderDialog({ server: { ...savedServer, hasPassword: false } })

    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'https://relocated.example.com')

    expect(screen.queryByText(originChangeWarning)).not.toBeInTheDocument()
  })
})
