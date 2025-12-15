import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Permission } from '@/api/types'

type PermissionEventType = 'add' | 'remove'

interface PermissionEvent {
  type: PermissionEventType
  permission?: Permission
  sessionID?: string
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

type PermissionsBySession = Record<string, Permission[]>

export function usePermissionRequests(currentSessionID?: string) {
  const [permissionsBySession, setPermissionsBySession] = useState<PermissionsBySession>({})

  useEffect(() => {
    const unsubscribe = permissionEvents.subscribe((event) => {
      if (event.type === 'add' && event.permission) {
        const permission = event.permission
        const sessionID = permission.sessionID
        
        setPermissionsBySession(prev => {
          const sessionPermissions = prev[sessionID] ?? []
          const existingIndex = sessionPermissions.findIndex(p => p.id === permission.id)
          
          if (existingIndex >= 0) {
            const updated = [...sessionPermissions]
            updated[existingIndex] = permission
            return { ...prev, [sessionID]: updated }
          }
          
          return { ...prev, [sessionID]: [...sessionPermissions, permission] }
        })
      } else if (event.type === 'remove' && event.permissionID && event.sessionID) {
        const { sessionID, permissionID } = event
        
        setPermissionsBySession(prev => {
          const sessionPermissions = prev[sessionID]
          if (!sessionPermissions) return prev
          
          const filtered = sessionPermissions.filter(p => p.id !== permissionID)
          if (filtered.length === 0) {
            return Object.fromEntries(
              Object.entries(prev).filter(([key]) => key !== sessionID)
            )
          }
          return { ...prev, [sessionID]: filtered }
        })
      }
    })
    return unsubscribe
  }, [])

  const allPermissions = useMemo(() => {
    return Object.values(permissionsBySession).flat()
  }, [permissionsBySession])

  const currentPermission = useMemo(() => {
    if (currentSessionID) {
      const sessionPerms = permissionsBySession[currentSessionID] ?? []
      if (sessionPerms.length > 0) return sessionPerms[0]
    }
    return allPermissions[0] ?? null
  }, [permissionsBySession, currentSessionID, allPermissions])

  const isFromDifferentSession = useMemo(() => {
    if (!currentPermission || !currentSessionID) return false
    return currentPermission.sessionID !== currentSessionID
  }, [currentPermission, currentSessionID])

  const dismissPermission = useCallback((permissionID: string, sessionID?: string) => {
    setPermissionsBySession(prev => {
      if (sessionID) {
        const sessionPermissions = prev[sessionID]
        if (!sessionPermissions) return prev
        
        const filtered = sessionPermissions.filter(p => p.id !== permissionID)
        if (filtered.length === 0) {
          return Object.fromEntries(
            Object.entries(prev).filter(([key]) => key !== sessionID)
          )
        }
        return { ...prev, [sessionID]: filtered }
      }
      
      const newState: PermissionsBySession = {}
      for (const [sid, perms] of Object.entries(prev)) {
        const filtered = perms.filter(p => p.id !== permissionID)
        if (filtered.length > 0) {
          newState[sid] = filtered
        }
      }
      return newState
    })
  }, [])

  const clearAllPermissions = useCallback(() => {
    setPermissionsBySession({})
  }, [])

  return {
    currentPermission,
    pendingCount: allPermissions.length,
    isFromDifferentSession,
    dismissPermission,
    clearAllPermissions
  }
}
