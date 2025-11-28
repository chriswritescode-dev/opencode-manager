import { useState, useEffect, useCallback } from 'react'
import type { Permission } from '@/api/types'

type PermissionEventType = 'add' | 'remove'

interface PermissionEvent {
  type: PermissionEventType
  permission?: Permission
  permissionID?: string
}

type PermissionListener = (event: PermissionEvent) => void

const listeners = new Set<PermissionListener>()

export const permissionEvents = {
  emit: (event: PermissionEvent) => {
    listeners.forEach(listener => listener(event))
  },
  subscribe: (listener: PermissionListener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

export function usePermissionRequests() {
  const [permissions, setPermissions] = useState<Permission[]>([])

  useEffect(() => {
    const unsubscribe = permissionEvents.subscribe((event) => {
      if (event.type === 'add' && event.permission) {
        setPermissions(prev => {
          const exists = prev.some(p => p.id === event.permission!.id)
          if (exists) return prev
          return [...prev, event.permission!]
        })
      } else if (event.type === 'remove' && event.permissionID) {
        setPermissions(prev => prev.filter(p => p.id !== event.permissionID))
      }
    })
    return unsubscribe
  }, [])

  const currentPermission = permissions[0] || null

  const dismissPermission = useCallback((permissionID: string) => {
    setPermissions(prev => prev.filter(p => p.id !== permissionID))
  }, [])

  const clearAllPermissions = useCallback(() => {
    setPermissions([])
  }, [])

  return {
    currentPermission,
    pendingCount: permissions.length,
    dismissPermission,
    clearAllPermissions
  }
}
