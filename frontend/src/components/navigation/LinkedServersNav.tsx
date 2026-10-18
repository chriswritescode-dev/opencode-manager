import { Link, useLocation } from 'react-router-dom'
import { Server } from 'lucide-react'
import { useOpenCodeServers, useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import { SidebarSection } from '@/components/ui/sidebar'
import { getServerPath } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export function LinkedServersNav() {
  const location = useLocation()
  const { servers, isLoading } = useOpenCodeServers()
  const { statusById } = useOpenCodeServerStatuses()
  const enabledServers = servers.filter((server) => server.enabled)

  if (isLoading || enabledServers.length === 0) {
    return null
  }

  return (
    <SidebarSection label="Servers" collapsed={false}>
      {enabledServers.map((server) => {
        const path = getServerPath(server.id)
        const active = location.pathname === path || location.pathname.startsWith(`${path}/`)
        const connected = statusById[server.id]?.connected ?? false

        return (
          <Link
            key={server.id}
            to={path}
            className={cn(
              'flex items-center gap-3 rounded-md p-2.5 text-sm transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
            )}
          >
            <Server className="h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{server.name}</span>
            <span
              role="img"
              aria-label={connected ? 'Connected' : 'Disconnected'}
              title={connected ? 'Connected' : 'Disconnected'}
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                connected ? 'bg-success' : 'bg-muted-foreground/40',
              )}
            />
          </Link>
        )
      })}
    </SidebarSection>
  )
}
