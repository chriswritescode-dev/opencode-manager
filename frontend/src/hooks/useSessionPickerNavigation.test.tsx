import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Repo, Session } from '@/api/types'
import { getServerSessionPath, getSessionListPath } from '@/lib/navigation'
import { getProjectHubPath } from '@/lib/projectTarget'
import { LocationCatcher } from '@/test/test-utils'
import { useSessionPickerNavigation } from './useSessionPickerNavigation'

function createSession(id: string): Session {
  return {
    id,
    projectID: 'proj-1',
    title: `Session ${id}`,
    time: { created: 1, updated: 2 },
    location: { directory: '/repos/1' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function createRepo(id: number): Repo {
  return {
    id,
    name: `repo-${id}`,
    fullPath: `/repos/${id}`,
    localPath: `/repos/${id}`,
    defaultBranch: 'main',
    currentBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
  }
}

function renderPickerNavigation(initialEntries: string[]) {
  const onClose = vi.fn()
  const navigateFromMenu = vi.fn()
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  const capturedNavigationType: { current: string } = { current: '' }
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <LocationCatcher
          capturedPathname={capturedPathname}
          capturedSearch={capturedSearch}
          capturedNavigationType={capturedNavigationType}
        />
        {children}
      </MemoryRouter>
    )
  }
  const rendered = renderHook(
    () => useSessionPickerNavigation({ onClose, navigateFromMenu }),
    { wrapper },
  )
  return {
    ...rendered,
    onClose,
    navigateFromMenu,
    location: () =>
      `${capturedPathname.current}${capturedSearch.current} ${capturedNavigationType.current}`,
  }
}

describe('useSessionPickerNavigation', () => {
  describe('selecting a session', () => {
    it('navigates to the chosen session without closing the menu', () => {
      const { result, onClose, navigateFromMenu } = renderPickerNavigation(
        ['/repos/1?mobileTab=sessions'],
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(1))
      })

      expect(navigateFromMenu).toHaveBeenCalledWith('/repos/1/sessions/b')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('keeps assistant mode when the chosen session belongs to the current repo', () => {
      const { result, navigateFromMenu } = renderPickerNavigation(
        ['/repos/1/sessions/a?assistant=1'],
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(1))
      })

      expect(navigateFromMenu).toHaveBeenCalledWith('/repos/1/sessions/b?assistant=1')
    })

    it('drops assistant mode when the chosen session belongs to another repo', () => {
      const { result, navigateFromMenu } = renderPickerNavigation(
        ['/repos/1/sessions/a?assistant=1'],
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(2))
      })

      expect(navigateFromMenu).toHaveBeenCalledWith('/repos/2/sessions/b')
    })

    it('closes the menu without navigating when the local session is already open', () => {
      const { result, onClose, navigateFromMenu } = renderPickerNavigation(
        ['/repos/1/sessions/a?mobileTab=sessions'],
      )

      act(() => {
        result.current.onSelectSession(createSession('a'), createRepo(1))
      })

      expect(navigateFromMenu).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('navigates to a session on another server', () => {
      const { result, navigateFromMenu } = renderPickerNavigation(
        ['/servers/srv_kitchen/sessions/a?mobileTab=sessions'],
      )

      act(() => {
        result.current.onSelectRemoteSession(createSession('b'), 'srv_hall')
      })

      expect(navigateFromMenu).toHaveBeenCalledWith(getServerSessionPath('srv_hall', 'b'))
    })

    it('closes the menu without navigating when the remote session is already open', () => {
      const { result, onClose, navigateFromMenu } = renderPickerNavigation(
        ['/servers/srv_kitchen/sessions/a?mobileTab=sessions'],
      )

      act(() => {
        result.current.onSelectRemoteSession(createSession('a'), 'srv_kitchen')
      })

      expect(navigateFromMenu).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleting the open session', () => {
    it('opens the session list of the repo in view', () => {
      const { result, navigateFromMenu } = renderPickerNavigation(
        ['/repos/1/sessions/a?repoTab=changes'],
      )

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(navigateFromMenu).toHaveBeenCalledWith(getSessionListPath(1, false, 'changes'))
    })

    it('opens the assistant session list for an assistant session', () => {
      const { result, navigateFromMenu } = renderPickerNavigation(
        ['/repos/1/sessions/a?assistant=1'],
      )

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(navigateFromMenu).toHaveBeenCalledWith(getSessionListPath(1, true))
    })

    it('opens the hub of the side menu project on the session server', () => {
      const { result, navigateFromMenu } = renderPickerNavigation([
        '/servers/srv_kitchen/sessions/a?menu=sessions&menuProject=server:srv_kitchen:%2Fapp',
      ])

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(navigateFromMenu).toHaveBeenCalledWith(
        getProjectHubPath({ kind: 'server', serverId: 'srv_kitchen', directory: '/app' }),
      )
    })

    it('goes home when the side menu project is on another server', () => {
      const { result, navigateFromMenu } = renderPickerNavigation([
        '/servers/srv_kitchen/sessions/a?menu=sessions&menuProject=server:srv_hall:%2Fapp',
      ])

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(navigateFromMenu).toHaveBeenCalledWith('/')
    })

    it('goes home when no side menu project is set', () => {
      const { result, navigateFromMenu } = renderPickerNavigation([
        '/servers/srv_kitchen/sessions/a?menu=sessions',
      ])

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(navigateFromMenu).toHaveBeenCalledWith('/')
    })
  })

  describe('selecting a project', () => {
    it('points the side menu at the repo in place', () => {
      const { result, onClose, location } = renderPickerNavigation(['/?menu=sessions'])

      act(() => {
        result.current.onSelectRepo(createRepo(3))
      })

      expect(location()).toBe('/?menu=sessions&menuProject=repo%3A3 REPLACE')
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('following a prepared path', () => {
    it('leaves the menu for the path in one operation', () => {
      const { result, navigateFromMenu } = renderPickerNavigation(['/?menu=sessions'])

      act(() => {
        result.current.onNavigate('/repos/1/schedules')
      })

      expect(navigateFromMenu).toHaveBeenCalledWith('/repos/1/schedules')
    })
  })
})
