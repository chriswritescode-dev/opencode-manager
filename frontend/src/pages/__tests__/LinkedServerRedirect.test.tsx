import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { LinkedServerRedirect } from '../LinkedServerRedirect'
import { SIDEBAR_SERVER_STORAGE_KEY, useSidebarServerStore } from '@/stores/sidebarServerStore'

function renderRedirect(serverId = 'srv_x') {
  return render(
    <MemoryRouter initialEntries={[`/servers/${serverId}`]}>
      <Routes>
        <Route path="/servers/:serverId" element={<LinkedServerRedirect />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LinkedServerRedirect', () => {
  beforeEach(() => {
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  })

  it('lands on home with the server selected', async () => {
    renderRedirect('srv_x')

    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(useSidebarServerStore.getState().serverId).toBe('srv_x')
    expect(JSON.parse(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY) ?? 'null')).toBe('srv_x')
  })
})
