import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocationCatcher } from '@/test/test-utils'
import { RouteErrorBoundary } from './route-error-boundary'

const mocks = vi.hoisted(() => ({
  error: undefined as unknown,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useRouteError: () => mocks.error }
})

function renderBoundary() {
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  render(
    <MemoryRouter initialEntries={['/does-not-exist']}>
      <LocationCatcher capturedSearch={capturedSearch} capturedPathname={capturedPathname} />
      <Routes>
        <Route path="/" element={null} />
        <Route path="*" element={<RouteErrorBoundary />} />
      </Routes>
    </MemoryRouter>,
  )
  return { capturedPathname, capturedSearch }
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    mocks.error = undefined
  })

  it('offers a way home for a 404', async () => {
    mocks.error = { status: 404, statusText: 'Not Found', internal: false, data: {} }

    const { capturedPathname } = renderBoundary()

    expect(screen.getByText('Page Not Found')).toBeInTheDocument()
    expect(screen.getByText('The page you are looking for does not exist.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }))

    await waitFor(() => {
      expect(capturedPathname.current).toBe('/')
    })
  })

  it('keeps the retry action for other statuses', () => {
    mocks.error = { status: 500, statusText: 'Server Error', internal: false, data: { message: 'Boom' } }

    renderBoundary()

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go home' })).not.toBeInTheDocument()
  })

  it('keeps the login action for auth errors', () => {
    mocks.error = { status: 401, statusText: 'Unauthorized', internal: false, data: {} }

    renderBoundary()

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})
