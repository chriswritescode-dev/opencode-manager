import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSandboxResourcesDialog } from './SessionSandboxResourcesDialog'
import { useSetSessionSandbox } from '@/hooks/useSessionSandbox'
import type { SessionSandboxResources } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useSessionSandbox')

function mockSetSessionSandbox() {
  vi.mocked(useSetSessionSandbox).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useSetSessionSandbox>)
}

interface DialogProps {
  open: boolean
  override: SessionSandboxResources | null
  effective: SessionSandboxResources
}

function renderDialog(props: DialogProps) {
  return render(
    <SessionSandboxResourcesDialog
      sessionID="ses_1"
      open={props.open}
      onOpenChange={vi.fn()}
      override={props.override}
      effective={props.effective}
    />,
  )
}

describe('SessionSandboxResourcesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetSessionSandbox()
  })

  it('keeps a typed value when the effective resources change while open', async () => {
    const user = userEvent.setup()
    const { rerender } = renderDialog({ open: true, override: null, effective: { cpus: 2, memoryMib: 4096 } })

    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '8')

    rerender(
      <SessionSandboxResourcesDialog
        sessionID="ses_1"
        open
        onOpenChange={vi.fn()}
        override={null}
        effective={{ cpus: 4, memoryMib: 8192 }}
      />,
    )

    expect(screen.getByLabelText('CPUs')).toHaveValue(8)
  })

  it('re-initializes the draft from the resources when reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderDialog({ open: true, override: null, effective: { cpus: 2, memoryMib: 4096 } })

    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '8')

    rerender(
      <SessionSandboxResourcesDialog
        sessionID="ses_1"
        open={false}
        onOpenChange={vi.fn()}
        override={null}
        effective={{ cpus: 2, memoryMib: 4096 }}
      />,
    )

    rerender(
      <SessionSandboxResourcesDialog
        sessionID="ses_1"
        open
        onOpenChange={vi.fn()}
        override={{ cpus: 4, memoryMib: 8192 }}
        effective={{ cpus: 2, memoryMib: 4096 }}
      />,
    )

    expect(screen.getByLabelText('CPUs')).toHaveValue(4)
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(8)
  })
})
