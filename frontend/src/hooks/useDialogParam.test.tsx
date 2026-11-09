import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { dialogSearch, openDialogParam, useRouteDialogParam } from './useDialogParam'
import { describe, it, expect, vi } from 'vitest'

describe('useRouteDialogParam', () => {
  function RouteDialogHarness({ name, ownedParams }: { name: string; ownedParams?: readonly string[] }) {
    const [isOpen, setOpen] = useRouteDialogParam(name, ownedParams)
    const location = useLocation()
    const navigate = useNavigate()

    return (
      <div>
        <span data-testid="dialog-state">{isOpen ? 'open' : 'closed'}</span>
        <span data-testid="search">{location.search}</span>
        <button onClick={() => setOpen(true)}>open</button>
        <button onClick={() => setOpen(false)}>close</button>
        <button onClick={() => navigate(-1)}>back</button>
      </div>
    )
  }

  it('returns false when the dialog matches but a tool belongs to another project', () => {
    render(
      <MemoryRouter initialEntries={['/?dialog=mcp&toolProject=proj-1']}>
        <RouteDialogHarness name="mcp" />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
  })

  it('returns true when the dialog matches and no project tool is set', () => {
    render(
      <MemoryRouter initialEntries={['/?dialog=mcp']}>
        <RouteDialogHarness name="mcp" />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('dialog-state').textContent).toBe('open')
  })

  it('closing removes the dialog, toolProject, and owned params while keeping unrelated params', () => {
    render(
      <MemoryRouter initialEntries={['/?dialog=mcp&toolProject=proj-1&terminal=pty-1&keep=1']}>
        <RouteDialogHarness name="mcp" ownedParams={['terminal']} />
      </MemoryRouter>,
    )

    act(() => { screen.getByText('close').click() })

    expect(screen.getByTestId('dialog-state').textContent).toBe('closed')
    const params = new URLSearchParams(screen.getByTestId('search').textContent ?? '')
    expect(params.has('dialog')).toBe(false)
    expect(params.has('toolProject')).toBe(false)
    expect(params.has('terminal')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('opening pushes the dialog and clears a stale toolProject in a single history entry', () => {
    render(
      <MemoryRouter initialEntries={['/?toolProject=proj-1&keep=1']}>
        <RouteDialogHarness name="mcp" />
      </MemoryRouter>,
    )

    act(() => { screen.getByText('open').click() })

    expect(screen.getByTestId('dialog-state').textContent).toBe('open')
    expect(screen.getByTestId('search').textContent).toBe('?keep=1&dialog=mcp')

    act(() => { screen.getByText('back').click() })

    expect(screen.getByTestId('search').textContent).toBe('?toolProject=proj-1&keep=1')
  })
})

describe('openDialogParam', () => {
  it('sets the dialog and extra params in one push while clearing mobileTab', () => {
    const updateParams = vi.fn()
    openDialogParam(updateParams, 'terminal', { terminal: 'pty-1' })

    expect(updateParams).toHaveBeenCalledTimes(1)
    const [updater, mode] = updateParams.mock.calls[0]
    expect(mode).toBe('push')

    const params = new URLSearchParams('mobileTab=more&keep=1')
    updater(params)

    expect(params.get('dialog')).toBe('terminal')
    expect(params.get('terminal')).toBe('pty-1')
    expect(params.get('keep')).toBe('1')
    expect(params.has('mobileTab')).toBe(false)
  })

  it('without extra params only sets the dialog', () => {
    const updateParams = vi.fn()
    openDialogParam(updateParams, 'mcp')

    const [updater] = updateParams.mock.calls[0]
    const params = new URLSearchParams()
    updater(params)

    expect(params.get('dialog')).toBe('mcp')
    expect([...params.keys()]).toEqual(['dialog'])
  })
})

describe('dialogSearch', () => {
  it('builds a query string from the dialog name and extra params', () => {
    expect(dialogSearch('terminal')).toBe('?dialog=terminal')
    expect(dialogSearch('terminal', { terminal: 'pty-1' })).toBe('?dialog=terminal&terminal=pty-1')
    expect(dialogSearch('preview', { previewPort: '5173', previewPath: '/' })).toBe(
      '?dialog=preview&previewPort=5173&previewPath=%2F',
    )
  })

  it('URL-encodes extra params and omits mobileTab', () => {
    const search = dialogSearch('terminal', { terminal: 'pty 1/2' })

    expect(search).toBe('?dialog=terminal&terminal=pty+1%2F2')
    expect(search).not.toContain('mobileTab')
  })
})
