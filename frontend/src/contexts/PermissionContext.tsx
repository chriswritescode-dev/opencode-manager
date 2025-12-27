/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { OpenCodeClient } from '@/api/opencode'
import { permissionEvents, usePermissionRequests } from '@/hooks/usePermissionRequests'
import type { Permission, PermissionResponse } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { showToast } from '@/lib/toast'


type SessionInfo = {
  id: string
  directory?: string
}

type ActiveRepo = {
  url: string
  directory?: string
  sessions: SessionInfo[]
}

interface PermissionContextValue {
  currentPermission: Permission | null
  pendingCount: number
  isFromDifferentSession: boolean
  respondToPermission: (permissionID: string, sessionID: string, response: PermissionResponse) => Promise<void>
  dismissPermission: (permissionID: string, sessionID?: string) => void
  showDialog: boolean
  setShowDialog: (show: boolean) => void
  currentSessionId: string | null
  getPermissionForCallID: (callID: string, sessionID: string) => Permission | null
  hasPermissionsForSession: (sessionID: string) => boolean
}

const PermissionContext = createContext<PermissionContextValue | null>(null)

function useActiveRepos(queryClient: ReturnType<typeof useQueryClient>): ActiveRepo[] {
  const [activeRepos, setActiveRepos] = useState<ActiveRepo[]>([])
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const checkRepos = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      
      timeoutRef.current = setTimeout(() => {
        const cache = queryClient.getQueryCache()
        const queries = cache.getAll()
        const repoMap = new Map<string, { directory?: string, sessionIds: Set<string> }>()

        queries.forEach((query) => {
          const key = query.queryKey
          
          if (key[0] === 'opencode' && key[1] === 'sessions' && key.length >= 4) {
            const url = key[2] as string
            const directory = key[3] as string | undefined
            
            if (!url || typeof url !== 'string') return

            const repoKey = `${url}|${directory ?? ''}`
            if (!repoMap.has(repoKey)) {
              repoMap.set(repoKey, { directory, sessionIds: new Set() })
            }

            const sessionsData = query.state.data as Array<{ id: string }> | undefined
            if (sessionsData) {
              sessionsData.forEach((session) => {
                repoMap.get(repoKey)!.sessionIds.add(session.id)
              })
            }
          } else if (key[0] === 'opencode' && key[1] === 'session' && key.length >= 5) {
            const url = key[2] as string
            const directory = key[4] as string | undefined
            const sessionData = query.state.data as { id: string } | undefined
            
            if (!url || typeof url !== 'string') return

            const repoKey = `${url}|${directory ?? ''}`
            if (!repoMap.has(repoKey)) {
              repoMap.set(repoKey, { directory, sessionIds: new Set() })
            }

            if (sessionData && sessionData.id) {
              repoMap.get(repoKey)!.sessionIds.add(sessionData.id)
            }
          }
        })

        const repos = Array.from(repoMap.entries())
          .filter(([repoKey]) => {
            const url = repoKey.split('|')[0]
            try {
              new URL(url)
              return true
            } catch {
              return false
            }
          })
          .map(([repoKey, { directory, sessionIds }]) => ({
            url: repoKey.split('|')[0],
            directory,
            sessions: Array.from(sessionIds).map((id) => ({ id })),
          }))

        setActiveRepos(repos)
      }, 0)
    }

    checkRepos()
    const unsubscribe = queryClient.getQueryCache().subscribe(checkRepos)
    
    return () => {
      unsubscribe()
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [queryClient])

  return activeRepos
}

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [showDialog, setShowDialog] = useState(true)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const activeRepos = useActiveRepos(queryClient)
  const clientsRef = useRef<Map<string, OpenCodeClient>>(new Map())
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map())
  const prevPendingCountRef = useRef(0)

  const {
    currentPermission,
    pendingCount,
    isFromDifferentSession,
    dismissPermission: dismiss,
    getPermissionForCallID,
    hasPermissionsForSession,
  } = usePermissionRequests()

  useEffect(() => {
    if (currentPermission?.sessionID) {
      setCurrentSessionId(currentPermission.sessionID)
    }
  }, [currentPermission])

  useEffect(() => {
    if (pendingCount > prevPendingCountRef.current && pendingCount > 0 && !showDialog) {
      showToast.info(`${pendingCount} pending permission${pendingCount > 1 ? 's' : ''}`, {
        duration: 5000,
        action: {
          label: 'View',
          onClick: () => setShowDialog(true),
        },
      })
    }
prevPendingCountRef.current = pendingCount
  }, [pendingCount, showDialog])

  const getClient = useCallback((sessionID: string): OpenCodeClient | null => {
    
    for (const repo of activeRepos) {
      if (repo.sessions.some((s) => s.id === sessionID)) {
        const clientKey = `${repo.url}|${repo.directory ?? ''}`
        let client = clientsRef.current.get(clientKey)
        if (!client) {
          client = new OpenCodeClient(repo.url, repo.directory)
          clientsRef.current.set(clientKey, client)
        }
        return client
      }
    }
    
    if (activeRepos.length === 0) {
      const cache = queryClient.getQueryCache()
      const queries = cache.getAll()
      
      for (const query of queries) {
        const key = query.queryKey
        
        if (key[0] === 'opencode' && key.length >= 5 && key[1] === 'session') {
          const sessionData = query.state.data as { id: string } | undefined
          if (sessionData?.id === sessionID) {
            const url = key[2] as string
            const directory = key[4] as string | undefined
            
            if (!url || typeof url !== 'string') continue
            
            const clientKey = `${url}|${directory ?? ''}`
            let client = clientsRef.current.get(clientKey)
            if (!client) {
              client = new OpenCodeClient(url, directory)
              clientsRef.current.set(clientKey, client)
            }
            console.log('[PermissionContext] Created client from query cache for fallback')
            return client
          }
        }
      }
    }
    
    return null
  }, [activeRepos, queryClient])

  useEffect(() => {
    const currentRefs = eventSourceRefs.current
    const currentClients = clientsRef.current
    const newKeys = new Set(activeRepos.map((r) => `${r.url}|${r.directory ?? ''}`))
    const existingKeys = new Set(currentRefs.keys())

    existingKeys.forEach((key) => {
      if (!newKeys.has(key)) {
        const es = currentRefs.get(key)
        if (es) {
          es.close()
          currentRefs.delete(key)
        }
        if (currentClients.has(key)) {
          currentClients.delete(key)
        }
      }
    })

    return () => {
      currentRefs.forEach((es) => es.close())
    }
  }, [activeRepos])

  useEffect(() => {
    const currentRefs = eventSourceRefs.current
    
    activeRepos.forEach((repo) => {
      if (!repo.url) return
      
      const repoKey = `${repo.url}|${repo.directory ?? ''}`
      const existingES = currentRefs.get(repoKey)
      if (existingES) return

      let url: URL
      try {
        url = new URL(repo.url)
      } catch {
        console.error('Invalid URL for SSE:', repo.url)
        return
      }
      
      if (url.pathname.endsWith('/')) {
        url.pathname += 'stream'
      } else {
        url.pathname += '/stream'
      }
      
      if (repo.directory) {
        url.searchParams.set('directory', repo.directory)
      }

      const es = new EventSource(url.toString())
      currentRefs.set(repoKey, es)

      es.addEventListener('permission.updated', (e) => {
        try {
          const event = JSON.parse(e.data)
          if ('id' in event.properties && 'sessionID' in event.properties) {
            permissionEvents.emit({ type: 'add', permission: event.properties })
          }
        } catch (err) {
          console.error('Failed to parse permission.updated event:', err)
        }
      })

      es.addEventListener('permission.replied', (e) => {
        try {
          const event = JSON.parse(e.data)
          if ('permissionID' in event.properties && 'sessionID' in event.properties) {
            permissionEvents.emit({
              type: 'remove',
              sessionID: event.properties.sessionID,
              permissionID: event.properties.permissionID,
            })
          }
        } catch (err) {
          console.error('Failed to parse permission.replied event:', err)
        }
      })

      es.onerror = (err) => {
        console.error(`SSE connection error for ${repo.url}:`, err)
        setTimeout(() => {
          currentRefs.delete(repoKey)
        }, 1000)
      }
    })

    return () => {
      currentRefs.forEach((es) => es.close())
      currentRefs.clear()
    }
  }, [activeRepos])

  const respondToPermission = useCallback(
    async (permissionID: string, sessionID: string, response: PermissionResponse) => {
      const client = getClient(sessionID)
      if (!client) {
        throw new Error('No client found for session')
      }
      await client.respondToPermission(sessionID, permissionID, response)
      dismiss(permissionID, sessionID)
    },
    [getClient, dismiss],
  )

  const value: PermissionContextValue = useMemo(
    () => ({
      currentPermission,
      pendingCount,
      isFromDifferentSession,
      respondToPermission,
      dismissPermission: dismiss,
      showDialog,
      setShowDialog,
      currentSessionId,
      getPermissionForCallID,
      hasPermissionsForSession,
    }),
    [
      currentPermission,
      pendingCount,
      isFromDifferentSession,
      respondToPermission,
      dismiss,
      showDialog,
      currentSessionId,
      getPermissionForCallID,
      hasPermissionsForSession,
    ],
)

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
  }

export function usePermissionContext() {
  const context = useContext(PermissionContext)
  if (!context) {
    throw new Error('usePermissionContext must be used within PermissionProvider')
  }
  return context
}