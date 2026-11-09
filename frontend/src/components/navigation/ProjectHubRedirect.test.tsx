import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
})
