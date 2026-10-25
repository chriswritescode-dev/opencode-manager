import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { isPanelTool, toggleToolDialogParams, toggleToolPanelParams, useToolPanel, useToolPanelToggle } from './useToolPanel'

describe('sessions tool', () => {
  it('is a panel tool', () => {
    expect(isPanelTool('sessions')).toBe(true)
  })

  it('clears without opening a dialog when the panel is not docked', async () => {
    function Probe() {
      useToolPanel(false)
      const location = useLocation()
      return createElement('div', { 'data-testid': 'search' }, location.search)
    }

    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/repos/1/sessions/abc?panel=sessions'] },
        createElement(Probe),
      ),
    )

    await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('panel=sessions'))
    expect(screen.getByTestId('search').textContent).not.toContain('dialog=sessions')
  })
})

describe('toggleToolPanelParams', () => {
  it('opens a tool, clears other tools owned params, and preserves unrelated params', () => {
    const params = new URLSearchParams('previewPort=3000&previewPath=%2Fx&keep=1')

    toggleToolPanelParams(params, 'terminal')

    expect(params.get('panel')).toBe('terminal')
    expect(params.has('previewPort')).toBe(false)
    expect(params.has('previewPath')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('keeps the opened tool owned params', () => {
    const params = new URLSearchParams('previewPort=3000&previewPath=%2Fx')

    toggleToolPanelParams(params, 'preview')

    expect(params.get('panel')).toBe('preview')
    expect(params.get('previewPort')).toBe('3000')
    expect(params.get('previewPath')).toBe('/x')
  })

  it('closes the active tool and clears every tool param', () => {
    const params = new URLSearchParams('panel=terminal&terminal=%2Fbin%2Fsh&terminalDirectory=%2Fhome&previewPort=3000&keep=1')

    toggleToolPanelParams(params, 'terminal')

    expect(params.has('panel')).toBe(false)
    expect(params.has('terminal')).toBe(false)
    expect(params.has('terminalDirectory')).toBe(false)
    expect(params.has('previewPort')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('switches from one tool to another and clears the previous owned params', () => {
    const params = new URLSearchParams('panel=preview&previewPort=3000&previewPath=%2Fx')

    toggleToolPanelParams(params, 'files')

    expect(params.get('panel')).toBe('files')
    expect(params.has('previewPort')).toBe(false)
    expect(params.has('previewPath')).toBe(false)
  })
})

describe('toggleToolDialogParams', () => {
  it('opens a dialog, clears mobileTab and other tools owned params', () => {    const params = new URLSearchParams('mobileTab=more&previewPort=3000&previewPath=%2Fx&keep=1')

    toggleToolDialogParams(params, 'terminal')

    expect(params.get('dialog')).toBe('terminal')
    expect(params.has('mobileTab')).toBe(false)
    expect(params.has('previewPort')).toBe(false)
    expect(params.has('previewPath')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })

  it('keeps the opened tool owned params', () => {
    const params = new URLSearchParams('mobileTab=more&terminal=%2Fbin%2Fsh&terminalDirectory=%2Fhome&previewPort=3000')

    toggleToolDialogParams(params, 'terminal')

    expect(params.get('dialog')).toBe('terminal')
    expect(params.get('terminal')).toBe('/bin/sh')
    expect(params.get('terminalDirectory')).toBe('/home')
    expect(params.has('previewPort')).toBe(false)
  })

  it('closes the active dialog and clears every tool param', () => {
    const params = new URLSearchParams('dialog=terminal&terminal=%2Fbin%2Fsh&terminalDirectory=%2Fhome&previewPort=3000&keep=1')

    toggleToolDialogParams(params, 'terminal')

    expect(params.has('dialog')).toBe(false)
    expect(params.has('terminal')).toBe(false)
    expect(params.has('terminalDirectory')).toBe(false)
    expect(params.has('previewPort')).toBe(false)
    expect(params.get('keep')).toBe('1')
  })
})

describe('panel history entries', () => {
  function PanelHarness() {
    const { activeTool, toggleTool, closePanel } = useToolPanel(true)
    const location = useLocation()
    const navigate = useNavigate()

    return createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'activeTool' }, activeTool ?? ''),
      createElement('span', { 'data-testid': 'search' }, location.search),
      createElement('span', { 'data-testid': 'pathname' }, location.pathname),
      createElement('button', { onClick: () => toggleTool('files') }, 'open files'),
      createElement('button', { onClick: () => toggleTool('terminal') }, 'open terminal'),
      createElement('button', { onClick: closePanel }, 'close'),
      createElement('button', { onClick: () => navigate(-1) }, 'back'),
    )
  }

  it('closing a panel the rail opened goes back instead of leaving a dead history entry', () => {
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/repos/1', '/repos/1/sessions/ses_1'], initialIndex: 1 },
        createElement(PanelHarness),
      ),
    )

    fireEvent.click(screen.getByText('open files'))
    expect(screen.getByTestId('search').textContent).toBe('?panel=files')

    fireEvent.click(screen.getByText('close'))
    expect(screen.getByTestId('search').textContent).toBe('')

    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('pathname').textContent).toBe('/repos/1')
  })

  it('closing the active tool from the rail goes back instead of replacing the entry', () => {
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/repos/1/sessions/ses_1'], initialIndex: 0 },
        createElement(PanelHarness),
      ),
    )

    fireEvent.click(screen.getByText('open files'))
    expect(screen.getByTestId('activeTool').textContent).toBe('files')

    fireEvent.click(screen.getByText('open files'))
    expect(screen.getByTestId('activeTool').textContent).toBe('')
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('switching tools keeps one history entry and closing returns to before the panel opened', () => {
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/repos/2', '/repos/2/sessions/ses_1'], initialIndex: 1 },
        createElement(PanelHarness),
      ),
    )

    fireEvent.click(screen.getByText('open files'))
    fireEvent.click(screen.getByText('open terminal'))
    expect(screen.getByTestId('search').textContent).toBe('?panel=terminal')

    fireEvent.click(screen.getByText('close'))
    expect(screen.getByTestId('search').textContent).toBe('')

    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('pathname').textContent).toBe('/repos/2')
  })

  it('closing a deep-linked panel replaces the entry instead of leaving the route', () => {
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/repos/2', '/repos/2/sessions/ses_1?panel=files'], initialIndex: 1 },
        createElement(PanelHarness),
      ),
    )

    expect(screen.getByTestId('activeTool').textContent).toBe('files')

    fireEvent.click(screen.getByText('close'))
    expect(screen.getByTestId('search').textContent).toBe('')
    expect(screen.getByTestId('pathname').textContent).toBe('/repos/2/sessions/ses_1')

    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('pathname').textContent).toBe('/repos/2')
  })
})

describe('useToolPanelToggle', () => {
  function ToggleHarness() {
    const toggleTool = useToolPanelToggle()
    const { activeTool } = useToolPanel(true)
    const location = useLocation()
    const navigate = useNavigate()

    return createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'activeTool' }, activeTool ?? ''),
      createElement('span', { 'data-testid': 'search' }, location.search),
      createElement('button', { onClick: () => toggleTool('files') }, 'open files'),
      createElement('button', { onClick: () => toggleTool('terminal') }, 'open terminal'),
      createElement('button', { onClick: () => navigate(-1) }, 'back'),
    )
  }

  function renderToggleHarness() {
    render(createElement(MemoryRouter, { initialEntries: ['/repos/1/sessions/ses_1'] }, createElement(ToggleHarness)))
  }

  it('opens the tool with a new history entry', () => {
    renderToggleHarness()

    fireEvent.click(screen.getByText('open files'))
    expect(screen.getByTestId('search').textContent).toBe('?panel=files')

    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('switches the open panel in place without a new history entry', () => {
    renderToggleHarness()

    fireEvent.click(screen.getByText('open files'))
    fireEvent.click(screen.getByText('open terminal'))
    expect(screen.getByTestId('search').textContent).toBe('?panel=terminal')

    fireEvent.click(screen.getByText('back'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('closes the panel when the tool is already open', () => {
    renderToggleHarness()

    fireEvent.click(screen.getByText('open files'))
    fireEvent.click(screen.getByText('open files'))

    expect(screen.getByTestId('activeTool').textContent).toBe('')
    expect(screen.getByTestId('search').textContent).toBe('')
  })
})
