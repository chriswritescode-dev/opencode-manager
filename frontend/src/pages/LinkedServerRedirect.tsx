import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

export function LinkedServerRedirect() {
  const { serverId } = useParams<{ serverId: string }>()
  const selectServer = useSidebarServerStore((state) => state.selectServer)

  useEffect(() => {
    if (serverId) selectServer(serverId)
  }, [serverId, selectServer])

  return <Navigate to="/" replace />
}
