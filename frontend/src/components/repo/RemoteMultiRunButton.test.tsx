import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RemoteMultiRunButton } from './RemoteMultiRunButton'

vi.mock('@/components/repo/MultiRunSheet', () => ({
  MultiRunSheet: ({
    target,
    directory,
    open,
  }: {
    target: { kind: string; serverId?: string; directory?: string }
    directory?: string
    open: boolean
  }) => (
    <div
      data-testid="multi-run-sheet"
      data-open={String(open)}
      data-kind={target.kind}
      data-server={target.serverId}
      data-target-directory={target.directory}
      data-directory={directory}
    />
  ),
}))

describe('RemoteMultiRunButton', () => {
  it('opens the multi-run sheet for the project directory on the linked server', async () => {
    const user = userEvent.setup()
    render(<RemoteMultiRunButton serverId="srv_kitchen" directory="/srv/app" />)

    expect(screen.queryByTestId('multi-run-sheet')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Multi-run' }))

    const sheet = screen.getByTestId('multi-run-sheet')
    expect(sheet).toHaveAttribute('data-open', 'true')
    expect(sheet).toHaveAttribute('data-kind', 'server')
    expect(sheet).toHaveAttribute('data-server', 'srv_kitchen')
    expect(sheet).toHaveAttribute('data-target-directory', '/srv/app')
    expect(sheet).toHaveAttribute('data-directory', '/srv/app')
  })
})
