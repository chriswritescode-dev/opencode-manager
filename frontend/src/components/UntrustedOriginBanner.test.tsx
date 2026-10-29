import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UntrustedOriginBanner } from './UntrustedOriginBanner'
import { useAuth } from '@/hooks/useAuth'

vi.mock('@/hooks/useAuth')

function renderBanner(originTrusted?: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    config: {
      enabledProviders: ['credentials'],
      registrationEnabled: true,
      isFirstUser: false,
      adminConfigured: false,
      originTrusted,
    },
  } as ReturnType<typeof useAuth>)
  return render(<UntrustedOriginBanner />)
}

describe('UntrustedOriginBanner', () => {
  it('names the current address and both settings for an untrusted origin', () => {
    renderBanner(false)

    const alerts = screen.getAllByRole('alert')

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent(
      `This address (${window.location.origin}) is not a trusted Manager address.`,
    )
    expect(alerts[0]).toHaveTextContent('MANAGER_PUBLIC_URL')
    expect(alerts[0]).toHaveTextContent('AUTH_TRUSTED_ORIGINS')
  })

  it('renders nothing for a trusted origin', () => {
    renderBanner(true)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders nothing when the trust flag is missing', () => {
    renderBanner(undefined)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
