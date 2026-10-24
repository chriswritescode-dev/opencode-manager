import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  buildManagerBrowserPairingLink,
  PAIRING_CODE_INVALID_MESSAGE,
} from '@opencode-manager/shared/schemas'
import { Login } from '../Login'

const mocks = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signInWithProvider: vi.fn(),
  signInWithPasskey: vi.fn(),
  signInWithPairingCode: vi.fn(),
  scanText: { value: '' },
}))

vi.mock('react-router-dom', () => ({
  useLoaderData: () => ({
    config: {
      enabledProviders: ['credentials', 'passkey'],
      registrationEnabled: true,
      isFirstUser: false,
      adminConfigured: false,
    },
  }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signInWithEmail: mocks.signInWithEmail,
    signInWithProvider: mocks.signInWithProvider,
    signInWithPasskey: mocks.signInWithPasskey,
    signInWithPairingCode: mocks.signInWithPairingCode,
  }),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => 'light',
}))

vi.mock('@/components/settings/QrCodeScanner', () => ({
  QrCodeScanner: ({ open, onResult }: { open: boolean; onResult: (text: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onResult(mocks.scanText.value)}>
        Deliver scanned text
      </button>
    ) : null,
}))

const code = 'a'.repeat(43)

function renderLogin() {
  return render(<Login />)
}

async function scan(text: string) {
  const user = userEvent.setup()
  mocks.scanText.value = text
  await user.click(screen.getByRole('button', { name: 'Sign in with QR code' }))
  await user.click(await screen.findByRole('button', { name: 'Deliver scanned text' }))
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scanText.value = ''
    mocks.signInWithPairingCode.mockResolvedValue({})
  })

  it('starts a QR scan from the sign-in button', async () => {
    const user = userEvent.setup()
    renderLogin()

    const button = screen.getByRole('button', { name: 'Sign in with QR code' })
    expect(button).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Deliver scanned text' })).not.toBeInTheDocument()

    await user.click(button)

    expect(await screen.findByRole('button', { name: 'Deliver scanned text' })).toBeInTheDocument()
  })

  it('redeems the code from a manager sign-in QR code', async () => {
    renderLogin()

    await scan(buildManagerBrowserPairingLink(window.location.origin, code))

    await waitFor(() => {
      expect(mocks.signInWithPairingCode).toHaveBeenCalledTimes(1)
    })
    expect(mocks.signInWithPairingCode).toHaveBeenCalledWith(code)
  })

  it('rejects a QR code for another origin', async () => {
    renderLogin()

    await scan(buildManagerBrowserPairingLink('https://other.example.com', code))

    expect(
      await screen.findByText(
        'This QR code is for https://other.example.com. Open that address to sign in.',
      ),
    ).toBeInTheDocument()
    expect(mocks.signInWithPairingCode).not.toHaveBeenCalled()
  })

  it.each(['ocm://link?v=2&kind=manager&name=Desk', 'not a pairing link'])(
    'rejects text that is not a manager sign-in code: %s',
    async (text) => {
      renderLogin()

      await scan(text)

      expect(
        await screen.findByText('That QR code is not a Manager sign-in code.'),
      ).toBeInTheDocument()
      expect(mocks.signInWithPairingCode).not.toHaveBeenCalled()
    },
  )

  it('shows the redeem error in the page alert', async () => {
    mocks.signInWithPairingCode.mockResolvedValue({ error: PAIRING_CODE_INVALID_MESSAGE })
    renderLogin()

    await scan(buildManagerBrowserPairingLink(window.location.origin, code))

    expect(await screen.findByText(PAIRING_CODE_INVALID_MESSAGE)).toBeInTheDocument()
  })
})
