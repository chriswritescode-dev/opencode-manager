import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useForms, usePermissions } from '@/contexts/EventContext'
import { useUnreadScheduleRuns } from '@/hooks/useSchedules'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { useNotificationsAction } from './useNotificationsAction'

vi.mock('@/contexts/EventContext')
vi.mock('@/hooks/useSchedules')
vi.mock('@/hooks/useMobileTabBar')

interface NotificationCounts {
  permissions?: number
  forms?: number
  reports?: number
  failed?: number
}

function mockNotifications(counts: NotificationCounts = {}) {
  const permissionNavigate = vi.fn()
  const setShowDialog = vi.fn()
  const formNavigate = vi.fn()
  const open = vi.fn()

  vi.mocked(usePermissions).mockReturnValue({
    pendingCount: counts.permissions ?? 0,
    navigateToCurrent: permissionNavigate,
    setShowDialog,
  } as ReturnType<typeof usePermissions>)
  vi.mocked(useForms).mockReturnValue({
    pendingCount: counts.forms ?? 0,
    navigateToCurrent: formNavigate,
  } as ReturnType<typeof useForms>)
  vi.mocked(useUnreadScheduleRuns).mockReturnValue({
    data: { runs: [], total: counts.reports ?? 0, failed: counts.failed ?? 0 },
  } as ReturnType<typeof useUnreadScheduleRuns>)
  vi.mocked(useMobileTabBar).mockReturnValue({
    openSheet: null,
    open,
    close: vi.fn(),
  } as ReturnType<typeof useMobileTabBar>)

  return { permissionNavigate, setShowDialog, formNavigate, open }
}

describe('useNotificationsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sums all notification counts and labels each part in plural', () => {
    mockNotifications({ permissions: 2, forms: 2, reports: 3 })

    const { result } = renderHook(() => useNotificationsAction())

    expect(result.current.permissionCount).toBe(2)
    expect(result.current.formCount).toBe(2)
    expect(result.current.reportCount).toBe(3)
    expect(result.current.count).toBe(7)
    expect(result.current.label).toBe('Notifications: 2 permissions, 2 forms, 3 unread reports')
  })

  it('uses singular labels for single notifications', () => {
    mockNotifications({ permissions: 1, forms: 1, reports: 1 })

    const { result } = renderHook(() => useNotificationsAction())

    expect(result.current.count).toBe(3)
    expect(result.current.label).toBe('Notifications: 1 permission, 1 form, 1 unread report')
  })

  it('labels an empty notification state as Notifications', () => {
    mockNotifications()

    const { result } = renderHook(() => useNotificationsAction())

    expect(result.current.count).toBe(0)
    expect(result.current.label).toBe('Notifications')
  })

  it('marks the action destructive when a report failed', () => {
    mockNotifications({ reports: 1, failed: 1 })

    const { result } = renderHook(() => useNotificationsAction())

    expect(result.current.destructive).toBe(true)
  })

  it('is not destructive when no report failed', () => {
    mockNotifications({ reports: 1 })

    const { result } = renderHook(() => useNotificationsAction())

    expect(result.current.destructive).toBe(false)
  })

  it('opens the permission dialog for a single pending permission', () => {
    const { permissionNavigate, setShowDialog, formNavigate, open } = mockNotifications({ permissions: 1 })

    const { result } = renderHook(() => useNotificationsAction())
    act(() => {
      result.current.press()
    })

    expect(permissionNavigate).toHaveBeenCalledTimes(1)
    expect(setShowDialog).toHaveBeenCalledWith(true)
    expect(formNavigate).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('navigates to a single pending form without opening the sheet', () => {
    const { permissionNavigate, setShowDialog, formNavigate, open } = mockNotifications({ forms: 1 })

    const { result } = renderHook(() => useNotificationsAction())
    act(() => {
      result.current.press()
    })

    expect(formNavigate).toHaveBeenCalledTimes(1)
    expect(permissionNavigate).not.toHaveBeenCalled()
    expect(setShowDialog).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the notifications sheet with two pending permissions', () => {
    const { permissionNavigate, setShowDialog, open } = mockNotifications({ permissions: 2 })

    const { result } = renderHook(() => useNotificationsAction())
    act(() => {
      result.current.press()
    })

    expect(open).toHaveBeenCalledWith('notifications')
    expect(permissionNavigate).not.toHaveBeenCalled()
    expect(setShowDialog).not.toHaveBeenCalled()
  })

  it('opens the notifications sheet for one permission plus one report', () => {
    const { permissionNavigate, setShowDialog, open } = mockNotifications({ permissions: 1, reports: 1 })

    const { result } = renderHook(() => useNotificationsAction())
    act(() => {
      result.current.press()
    })

    expect(open).toHaveBeenCalledWith('notifications')
    expect(permissionNavigate).not.toHaveBeenCalled()
    expect(setShowDialog).not.toHaveBeenCalled()
  })

  it('opens the notifications sheet when there is nothing pending', () => {
    const { permissionNavigate, setShowDialog, formNavigate, open } = mockNotifications()

    const { result } = renderHook(() => useNotificationsAction())
    act(() => {
      result.current.press()
    })

    expect(open).toHaveBeenCalledWith('notifications')
    expect(permissionNavigate).not.toHaveBeenCalled()
    expect(setShowDialog).not.toHaveBeenCalled()
    expect(formNavigate).not.toHaveBeenCalled()
  })
})
