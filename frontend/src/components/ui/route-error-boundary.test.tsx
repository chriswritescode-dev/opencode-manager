import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installNavigationRequest } from '@/test/browserFakes'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { RouteErrorBoundary } from './route-error-boundary'

interface RouteFailure {
  status: number
  statusText: string
  message?: string
}

function renderBoundary(failure: RouteFailure) {
  installNavigationRequest()
  const body = failure.message === undefined ? null : JSON.stringify({ message: failure.message })
  const router = createMemoryRouter(
    [
      { path: '/', element: <div>home</div> },
      {
        path: '/broken',
        loader: () => {
          throw new Response(body, {
            status: failure.status,
            statusText: failure.statusText,
            headers: body === null ? undefined : { 'Content-Type': 'application/json' },
          })
        },
        element: <div>broken</div>,
        errorElement: <RouteErrorBoundary />,
      },
    ],
    { initialEntries: ['/broken'], hydrateFallbackElement: <div>loading</div> },
  )

  render(<RouterProvider router={router} />)
  return router
}

describe('RouteErrorBoundary', () => {
  it('offers a way home for a 404', async () => {
    const user = userEvent.setup()
    const router = renderBoundary({ status: 404, statusText: 'Not Found' })

    expect(await screen.findByText('Page Not Found')).toBeInTheDocument()
    expect(screen.getByText('The page you are looking for does not exist.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go home' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('keeps the retry action for other statuses', async () => {
    renderBoundary({ status: 500, statusText: 'Server Error', message: 'Boom' })

    expect(await screen.findByText('Server Error')).toBeInTheDocument()
    expect(screen.getByText('Boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go home' })).not.toBeInTheDocument()
  })

  it('keeps the login action for auth errors', async () => {
    renderBoundary({ status: 401, statusText: 'Unauthorized' })

    expect(await screen.findByText('Authentication Required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})
