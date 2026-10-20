import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

/**
 * Legacy `/servers/:serverId` entry point: selects that server in the sidebar and returns home,
 * where the center section lists the selected server's projects.
 */
export function LinkedServerRedirect() {
  const { serverId } = useParams<{ serverId: string }>()
  const selectServer = useSidebarServerStore((state) => state.selectServer)

  useEffect(() => {
    if (serverId) selectServer(serverId)
  }, [serverId, selectServer])

  return <Navigate to="/" replace />
}
