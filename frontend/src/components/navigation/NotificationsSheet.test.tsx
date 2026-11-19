import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { FormInfo, PermissionRequest } from '@opencode-manager/shared/opencode'
import { NotificationsSheet } from './NotificationsSheet'
import { connectTestEventStream, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { formCreated, permissionAsked } from '@/test/fixtures/events'
import { makeRepo } from '@/test/fixtures/api'

const directory = '/repo'

function permission(id: string): PermissionRequest {
  return {
    id,
    sessionID: 'session-1',
    action: 'shell',
    resources: ['/test/pattern'],
    metadata: {},
  }
}

const pendingForm: FormInfo = {
  id: 'form-1',
  sessionID: 'session-1',
  title: 'Test question',
  fields: [{ key: 'q0', type: 'string', options: [] }],
}

interface SheetOptions {
  permissions?: PermissionRequest[]
  forms?: FormInfo[]
}

async function renderSheet(options: SheetOptions = {}) {
  const onClose = vi.fn()
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <NotificationsSheet isOpen onClose={onClose} />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: '/repos/1/sessions/session-1',
      events: true,
      fetchRoutes: appRoutes({ repos: [makeRepo({ id: 1, fullPath: directory })] }),
    },
  )
  await connectTestEventStream(result.eventStream)
  act(() => {
    for (const request of options.permissions ?? []) {
      result.eventStream?.message(permissionAsked(request, { directory }))
    }
    for (const form of options.forms ?? []) {
      result.eventStream?.message(formCreated(form, { directory }))
    }
  })
  await act(async () => {
    await Promise.resolve()
  })
  return { ...result, onClose, capturedPathname, capturedSearch }
}

describe('NotificationsSheet', () => {
  it('renders empty state when both counts are 0', async () => {
    await renderSheet()

    expect(screen.getAllByText("You're all caught up").length).toBe(2)
  })

  it('renders permission section with pending count', async () => {
    await renderSheet({ permissions: [permission('perm-1'), permission('perm-2')] })

    expect(await screen.findByText('Pending permissions')).toBeInTheDocument()
    expect(await screen.findByText('Run Command')).toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('renders form section with pending count', async () => {
    await renderSheet({ forms: [pendingForm] })

    expect(await screen.findByText('Pending forms')).toBeInTheDocument()
    expect(await screen.findByText('Test question')).toBeInTheDocument()
  })

  it('navigates to the pending permission session and closes the sheet when clicked', async () => {
    const { capturedPathname, onClose } = await renderSheet({ permissions: [permission('perm-1')] })

    fireEvent.click(await screen.findByText('/test/pattern'))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1/sessions/session-1'))
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates to the pending form session and closes the sheet when clicked', async () => {
    const { capturedPathname, onClose } = await renderSheet({ forms: [pendingForm] })

    fireEvent.click(await screen.findByText('Test question'))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1/sessions/session-1'))
    expect(onClose).toHaveBeenCalled()
  })
})
