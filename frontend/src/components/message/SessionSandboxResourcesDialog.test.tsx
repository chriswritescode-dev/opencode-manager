import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSandboxResourcesDialog } from './SessionSandboxResourcesDialog'
import { renderWithProviders } from '@/test/render'
import { makeSessionSandboxState } from '@/test/fixtures/api'
import type { SessionSandboxResources } from '@opencode-manager/shared/schemas'

interface DialogProps {
  open: boolean
  override: SessionSandboxResources | null
  effective: SessionSandboxResources
}

const initialProps: DialogProps = { open: true, override: null, effective: { cpus: 2, memoryMib: 4096 } }

function Controller({ change }: { change: (next: DialogProps) => void }) {
  const [props, setProps] = useState(initialProps)
  change(setProps)
  return (
    <SessionSandboxResourcesDialog
      sessionID="ses_1"
      open={props.open}
      onOpenChange={vi.fn()}
      override={props.override}
      effective={props.effective}
    />
  )
}

function renderDialog() {
  let change: (next: DialogProps) => void = () => undefined
  const result = renderWithProviders(<Controller change={(next) => { change = next }} />, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: [
      { method: 'GET', path: '/api/session-sandbox/ses_1', respond: () => ({ json: makeSessionSandboxState() }) },
      { method: 'PUT', path: '/api/session-sandbox/ses_1', respond: () => ({ json: makeSessionSandboxState() }) },
    ],
  })
  return {
    ...result,
    update: async (next: DialogProps) => {
      await act(async () => {
        change(next)
      })
    },
  }
}

describe('SessionSandboxResourcesDialog', () => {
  it('keeps a typed value when the effective resources change while open', async () => {
    const user = userEvent.setup()
    const { update } = renderDialog()

    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '8')

    await update({ open: true, override: null, effective: { cpus: 4, memoryMib: 8192 } })

    expect(screen.getByLabelText('CPUs')).toHaveValue(8)
  })

  it('re-initializes the draft from the resources when reopened', async () => {
    const user = userEvent.setup()
    const { update } = renderDialog()

    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '8')

    await update({ open: false, override: null, effective: { cpus: 2, memoryMib: 4096 } })
    await update({ open: true, override: { cpus: 4, memoryMib: 8192 }, effective: { cpus: 2, memoryMib: 4096 } })

    expect(screen.getByLabelText('CPUs')).toHaveValue(4)
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(8)
  })
})
