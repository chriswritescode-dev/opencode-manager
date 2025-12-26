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
        const repoMap = new Map<string, Set<string>>()

        queries.forEach((query) => {
          const key = query.queryKey
          if (key[0] === 'opencode' && key[1] === 'sessions') {
            const url = key[2] as string
            
            if (!url || typeof url !== 'string') return

            if (!repoMap.has(url)) {
              repoMap.set(url, new Set())
            }

            const sessionsData = query.state.data as Array<{ id: string }> | undefined
            if (sessionsData) {
              sessionsData.forEach((session) => {
                repoMap.get(url)!.add(session.id)
              })
            }
          }
        })

        const repos = Array.from(repoMap.entries())
          .filter(([url]) => {
            try {
              new URL(url)
              return true
            } catch {
              return false
            }
          })
          .map(([url, sessionIds]) => ({
            url,
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
        let client = clientsRef.current.get(repo.url)
        if (!client) {
          client = new OpenCodeClient(repo.url, repo.directory)
          clientsRef.current.set(repo.url, client)
        }
        return client
      }
    }
    return null
}, [activeRepos])

  useEffect(() => {
    const currentRefs = eventSourceRefs.current
    const newURLs = new Set(activeRepos.map((r) => r.url))
    const existingURLs = new Set(currentRefs.keys())

    existingURLs.forEach((url) => {
      if (!newURLs.has(url)) {
        const es = currentRefs.get(url)
        if (es) {
          es.close()
          currentRefs.delete(url)
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
      
      const existingES = currentRefs.get(repo.url)
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

      const es = new EventSource(url.toString())
      currentRefs.set(repo.url, es)

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
          currentRefs.delete(repo.url)
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
    }),
    [
      currentPermission,
      pendingCount,
      isFromDifferentSession,
      respondToPermission,
      dismiss,
      showDialog,
      currentSessionId,
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