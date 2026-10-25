import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Repo, Session } from '@/api/types'
import { LocationCatcher } from '@/test/test-utils'
import {
  useSessionPickerNavigation,
  type SessionPickerNavigationOptions,
} from './useSessionPickerNavigation'

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

function renderPickerNavigation(
  initialEntries: string[],
  options: Omit<SessionPickerNavigationOptions, 'onClose'>,
) {
  const onClose = vi.fn()
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
  const rendered = renderHook(() => useSessionPickerNavigation({ ...options, onClose }), { wrapper })
  return {
    ...rendered,
    onClose,
    location: () =>
      `${capturedPathname.current}${capturedSearch.current} ${capturedNavigationType.current}`,
  }
}

describe('useSessionPickerNavigation', () => {
  describe('panel mode', () => {
    it('pushes the chosen session and keeps the panel open', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a?panel=sessions'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(1))
      })

      expect(location()).toBe('/repos/1/sessions/b?panel=sessions PUSH')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('keeps the panel param when opening a session on another server', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/servers/srv_kitchen/sessions/a?panel=sessions'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onSelectRemoteSession(createSession('b'), 'srv_hall')
      })

      expect(location()).toBe('/servers/srv_hall/sessions/b?panel=sessions PUSH')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does nothing when the chosen local session is already open', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a?panel=sessions'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onSelectSession(createSession('a'), createRepo(1))
      })

      expect(location()).toBe('/repos/1/sessions/a?panel=sessions POP')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does nothing when the chosen remote session is already open', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/servers/srv_kitchen/sessions/a?panel=sessions'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onSelectRemoteSession(createSession('a'), 'srv_kitchen')
      })

      expect(location()).toBe('/servers/srv_kitchen/sessions/a?panel=sessions POP')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('leaves the path unchanged without a panel param', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(1))
      })

      expect(location()).toBe('/repos/1/sessions/b PUSH')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does not carry an empty panel param', () => {
      const { result, location } = renderPickerNavigation(['/repos/1/sessions/a?panel='], {
        mode: 'panel',
      })

      act(() => {
        result.current.onSelectRepo(createRepo(2))
      })

      expect(location()).toBe('/repos/2 PUSH')
    })

    it('pushes a prepared path with the panel param and keeps the picker open', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a?panel=sessions'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onNavigate('/repos/1/schedules')
      })

      expect(location()).toBe('/repos/1/schedules?panel=sessions PUSH')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('calls only the delete override when one is supplied', () => {
      const onDeleteActiveSession = vi.fn()
      const { result, onClose, location } = renderPickerNavigation(
        ['/servers/srv_kitchen/sessions/a?panel=sessions'],
        { mode: 'panel', onDeleteActiveSession },
      )

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(onDeleteActiveSession).toHaveBeenCalledTimes(1)
      expect(location()).toBe('/servers/srv_kitchen/sessions/a?panel=sessions POP')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does nothing when deleting without an override outside a repo route', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/servers/srv_kitchen/sessions/a?panel=sessions'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(location()).toBe('/servers/srv_kitchen/sessions/a?panel=sessions POP')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('opens the session list with the panel param when a repo is in view', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a?panel=sessions&repoTab=changes'],
        { mode: 'panel' },
      )

      act(() => {
        result.current.onDeleteActiveSession()
      })

      expect(location()).toBe('/repos/1?repoTab=changes&panel=sessions PUSH')
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('push mode', () => {
    it('pushes the chosen session and closes the picker', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1?mobileTab=sessions'],
        { mode: 'push' },
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(1))
      })

      expect(location()).toBe('/repos/1/sessions/b PUSH')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes the picker without navigating when the session is already open', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a?mobileTab=sessions'],
        { mode: 'push' },
      )

      act(() => {
        result.current.onSelectSession(createSession('a'), createRepo(1))
      })

      expect(location()).toBe('/repos/1/sessions/a?mobileTab=sessions POP')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('replace mode', () => {
    it('replaces the entry without closing the picker', () => {
      const { result, onClose, location } = renderPickerNavigation(
        ['/repos/1/sessions/a?mobileTab=sessions'],
        { mode: 'replace' },
      )

      act(() => {
        result.current.onSelectSession(createSession('b'), createRepo(1))
      })

      expect(location()).toBe('/repos/1/sessions/b REPLACE')
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
