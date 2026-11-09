import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { CalendarClock, Plug, Settings } from 'lucide-react'
import type { NavItem } from '@/components/navigation/navItems'
import type { ProjectTarget } from '@/lib/projectTarget'
import { LocationCatcher } from '@/test/test-utils'
import { useOpenProjectTool } from './useOpenProjectTool'

const repo1: ProjectTarget = { kind: 'repo', repoId: 1 }
const repo2: ProjectTarget = { kind: 'repo', repoId: 2 }

function renderTool(initialEntries: string[], initialIndex?: number) {
  const capturedSearch = { current: '' }
  const capturedPathname = { current: '' }

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      MemoryRouter,
      { initialEntries, initialIndex },
      createElement(LocationCatcher, { capturedSearch, capturedPathname }),
      children,
    )
  }

  const rendered = renderHook(() => ({
    open: useOpenProjectTool(),
    navigate: useNavigate(),
  }), { wrapper: Wrapper })

  return { ...rendered, capturedSearch, capturedPathname }
}

function dialogItem(dialog: string): NavItem {
  return { key: dialog, label: dialog, icon: Plug, dialog }
}

describe('useOpenProjectTool', () => {
  it('opens a same-project dialog, drops the menu params, and leaves no toolProject', () => {
    const { result, capturedSearch } = renderTool(['/repos/1?menu=home&menuProject=repo:1'])

    let handled = false
    act(() => {
      handled = result.current.open({ ...dialogItem('mcp'), key: 'mcp' }, repo1)
    })

    expect(handled).toBe(true)
    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('dialog')).toBe('mcp')
    expect(params.has('toolProject')).toBe(false)
    expect(params.has('menu')).toBe(false)
    expect(params.has('menuProject')).toBe(false)
  })

  it('tags a same-project dialog the route page does not host, so ProjectToolsHost opens it', () => {
    const { result, capturedSearch } = renderTool(['/repos/1/sessions/abc?menu=home&menuProject=repo:1'])

    act(() => {
      result.current.open({ ...dialogItem('secrets'), key: 'secrets' }, repo1)
    })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('dialog')).toBe('secrets')
    expect(params.get('toolProject')).toBe('repo:1')
    expect(params.has('menu')).toBe(false)
    expect(params.has('menuProject')).toBe(false)
  })

  it('keeps a same-project dialog the route page hosts on the route host', () => {
    const { result, capturedSearch } = renderTool(['/repos/1/sessions/abc?menu=home&menuProject=repo:1'])

    act(() => {
      result.current.open({ ...dialogItem('files'), key: 'files' }, repo1)
    })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('dialog')).toBe('files')
    expect(params.has('toolProject')).toBe(false)
  })

  it('replaces the menu entry with a dialog tagged for a different project, so Back leaves the menu', () => {
    const { result, capturedSearch } = renderTool(
      ['/repos/1', '/repos/1?menu=home&menuProject=repo:2'],
      1,
    )

    act(() => {
      result.current.open({ ...dialogItem('files'), key: 'files' }, repo2)
    })

    const params = new URLSearchParams(capturedSearch.current)
    expect(params.get('dialog')).toBe('files')
    expect(params.get('toolProject')).toBe('repo:2')
    expect(params.has('menu')).toBe(false)
    expect(params.has('menuProject')).toBe(false)

    act(() => {
      result.current.navigate(-1)
    })

    expect(capturedSearch.current).toBe('')
  })

  it('navigates a schedules item with the current route as returnTo', () => {
    const { result, capturedSearch, capturedPathname } = renderTool(['/repos/1/sessions/abc?tab=changes'])

    act(() => {
      result.current.open(
        { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: '/repos/1/schedules' },
        repo1,
      )
    })

    expect(capturedPathname.current).toBe('/repos/1/schedules')
    expect(new URLSearchParams(capturedSearch.current).get('returnTo')).toBe('/repos/1/sessions/abc?tab=changes')
  })

  it('returns false for an item with neither a route nor a dialog', () => {
    const { result, capturedSearch } = renderTool(['/repos/1'])

    let handled = true
    act(() => {
      handled = result.current.open({ key: 'settings', label: 'Settings', icon: Settings }, repo1)
    })

    expect(handled).toBe(false)
    expect(capturedSearch.current).toBe('')
  })
})
