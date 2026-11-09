import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { parseProjectTarget } from '@/lib/projectTarget'
import { ProjectHubRedirect } from './ProjectHubRedirect'

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => { navigate(-1) }}>
        back
      </button>
    </div>
  )
}

function renderAt(initialEntries: string[], initialIndex?: number) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route path="/" element={<LocationProbe />} />
        <Route path="/assistant" element={<ProjectHubRedirect />} />
        <Route path="/repos/:id" element={<ProjectHubRedirect />} />
        <Route path="/repos/:id/assistant" element={<ProjectHubRedirect />} />
        <Route path="/servers/:serverId/projects" element={<ProjectHubRedirect />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectHubRedirect', () => {
  it('replaces the repo route with the Home hub so back does not return to it', async () => {
    renderAt(['/', '/repos/1'], 1)

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/?menu=sessions&menuProject=repo:1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'back' }))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    })
    expect(screen.getByTestId('location')).not.toHaveTextContent('/repos/1')
  })

  it('opens the workspaces tab for the repo workspaces tab', async () => {
    renderAt(['/repos/1?repoTab=workspaces'])

    await waitFor(() => {
      const text = screen.getByTestId('location').textContent ?? ''
      expect(text).toContain('menuProject=repo:1')
      expect(text).toContain('repoTab=workspaces')
    })
  })

  it('maps repo assistant and assistant routes to the assistant project', async () => {
    const { unmount } = renderAt(['/repos/7/assistant'])

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('menuProject=repo:0')
    })

    unmount()
    renderAt(['/assistant'])

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('menuProject=repo:0')
    })
  })

  it('redirects a linked-server project route to the Home hub for that project', async () => {
    renderAt(['/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp'])

    await waitFor(() => {
      const text = screen.getByTestId('location').textContent ?? ''
      expect(text.startsWith('/?menu=sessions&menuProject=')).toBe(true)
      const params = new URLSearchParams(text.slice(text.indexOf('?')))
      expect(parseProjectTarget(params.get('menuProject'))).toEqual({
        kind: 'server',
        serverId: 'srv_kitchen',
        directory: '/home/me/app',
      })
    })
  })

  it('redirects a linked-server project route without a directory to Home', async () => {
    renderAt(['/servers/srv_kitchen/projects'])

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    })
  })
})
