import { vi } from 'vitest'

vi.mock('@/hooks/useSchedules', () => ({
  useUnreadScheduleRuns: vi.fn(() => ({ data: undefined })),
}))

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { LocationCatcher } from '@/test/test-utils'
import { useUnreadScheduleRuns } from '@/hooks/useSchedules'
import type { ProjectTarget } from '@/lib/projectTarget'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { getMobileTabRouteState, useTabDestinations } from './tabDestinations'

function renderDestinations(
  initialEntry: string,
  target: ProjectTarget | null,
  options: { inMenu: boolean } = { inMenu: false },
) {
  const capturedSearch = { current: '' }
  const capturedPathname = { current: '' }
  const queryClient = new QueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        createElement(LocationCatcher, { capturedSearch, capturedPathname }),
        children,
      ),
    )
  }

  const rendered = renderHook(() => useTabDestinations(target, options), { wrapper: Wrapper })
  return { ...rendered, capturedSearch, capturedPathname }
}

function labels(tabs: ReturnType<typeof useTabDestinations>): string[] {
  return tabs.map((tab) => tab.label)
}

describe('getMobileTabRouteState', () => {
  it.each([
    ['/', '', 'global'],
    ['/schedules', '', 'global'],
    ['/repos/1', '', 'global'],
    ['/repos/1/schedules', '', 'schedule'],
    ['/repos/1/sessions/a', '', 'hidden'],
    ['/assistant', '', 'global'],
    ['/servers/srv/projects', '?directory=%2Ftmp', 'global'],
    ['/servers/srv/sessions/a', '', 'hidden'],
    ['/login', '', 'hidden'],
  ])('returns %s + %s as %s', (pathname, search, mode) => {
    expect(getMobileTabRouteState(pathname, search)).toBe(mode)
  })
})

describe('useTabDestinations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(useUnreadScheduleRuns).mockReturnValue(
      { data: undefined } as unknown as ReturnType<typeof useUnreadScheduleRuns>,
    )
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  })

  it('builds Sessions, Files, Assistant and Schedules for no project on the local server', () => {
    const { result } = renderDestinations('/', null)

    expect(labels(result.current)).toEqual(['Sessions', 'Files', 'Assistant', 'Schedules'])
  })

  it('builds Sessions, Files, Git and Assistant for a repo project', () => {
    const { result } = renderDestinations('/repos/2', { kind: 'repo', repoId: 2 })

    expect(labels(result.current)).toEqual(['Sessions', 'Files', 'Git', 'Assistant'])
  })

  it('builds Sessions, Files, Assistant and Schedules without Git for the assistant repo', () => {
    const { result } = renderDestinations('/assistant', { kind: 'repo', repoId: 0 })

    expect(labels(result.current)).toEqual(['Sessions', 'Files', 'Assistant', 'Schedules'])
  })

  it('builds Sessions, Git and Assistant for a linked server project', () => {
    const { result } = renderDestinations('/servers/srv/projects?directory=%2Ftmp', {
      kind: 'server',
      serverId: 'srv',
      directory: '/tmp',
    })

    expect(labels(result.current)).toEqual(['Sessions', 'Git', 'Assistant'])
  })

  it('hides Files for no project when a remote server is selected', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    const { result } = renderDestinations('/', null)

    expect(labels(result.current)).toEqual(['Sessions', 'Assistant', 'Schedules'])
  })

  it('opens the sessions side menu with the project in view on Sessions click', () => {
    const { result, capturedSearch } = renderDestinations('/repos/2', { kind: 'repo', repoId: 2 })

    act(() => {
      result.current.find((tab) => tab.key === 'sessions')?.onClick()
    })

    expect(capturedSearch.current).toContain('menu=sessions')
    expect(capturedSearch.current).toContain('menuProject=repo%3A2')
  })

  it('navigates to /schedules on Schedules click', () => {
    const { result, capturedPathname } = renderDestinations('/', null)

    act(() => {
      result.current.find((tab) => tab.key === 'schedules')?.onClick()
    })

    expect(capturedPathname.current).toBe('/schedules')
  })

  it('marks Schedules with a badge when unread runs are waiting', () => {
    vi.mocked(useUnreadScheduleRuns).mockReturnValue({
      data: { total: 2, runs: [] },
    } as unknown as ReturnType<typeof useUnreadScheduleRuns>)
    const { result } = renderDestinations('/', null)

    expect(result.current.find((tab) => tab.key === 'schedules')?.badge).toBe(true)
  })
})
