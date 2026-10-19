import { Link, useLocation } from 'react-router-dom'
import { Server } from 'lucide-react'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { useOpenCodeServers, useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import { useServerActivityState } from '@/hooks/useActiveWork'
import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { SidebarSection } from '@/components/ui/sidebar'
import { getServerPath } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export type LinkedServersVariant = 'sidebar' | 'rail' | 'sheet'

interface LinkedServersNavProps {
  /** `sidebar` renders the labelled section, `rail` the collapsed icon column, `sheet` the mobile sheet group. */
  variant?: LinkedServersVariant
  /** When provided, each row is a button that hands navigation to the caller instead of rendering a link. */
  onNavigate?: (path: string) => void
}

function isActiveServerPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`)
}

function ServerConnectionDot({ connected }: { connected: boolean }) {
  const label = connected ? 'Connected' : 'Disconnected'

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/40')}
    />
  )
}

interface LinkedServerRowProps {
  server: OpenCodeServer
  variant: 'sidebar' | 'sheet'
  path: string
  active: boolean
  connected: boolean
  onNavigate?: (path: string) => void
}

function LinkedServerRow({ server, variant, path, active, connected, onNavigate }: LinkedServerRowProps) {
  const activity = useServerActivityState(server.id)
  const className = cn(
    'flex items-center gap-3 rounded-md p-2.5 text-sm transition-colors duration-150',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
    variant === 'sheet' && 'mx-2 p-2 text-left',
  )
  const content = (
    <>
      <Server className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{server.name}</span>
      <ActivityStateIndicator state={activity} />
      <ServerConnectionDot connected={connected} />
    </>
  )

  if (onNavigate) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(path)}
        aria-current={active ? 'page' : undefined}
        className={className}
      >
        {content}
      </button>
    )
  }

  return (
    <Link to={path} className={className}>
      {content}
    </Link>
  )
}

export function LinkedServersNav({ variant = 'sidebar', onNavigate }: LinkedServersNavProps) {
  const location = useLocation()
  const { servers, isLoading } = useOpenCodeServers()
  const { statusById } = useOpenCodeServerStatuses()
  const enabledServers = servers.filter((server) => server.enabled)

  if (isLoading || enabledServers.length === 0) {
    return null
  }

  if (variant === 'rail') {
    return (
      <div className="flex flex-col gap-1 px-2">
        {enabledServers.map((server) => {
          const path = getServerPath(server.id)
          const active = isActiveServerPath(location.pathname, path)

          return (
            <Link
              key={server.id}
              to={path}
              title={server.name}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center justify-center rounded-md p-2.5 transition-colors duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
              )}
            >
              <Server className="h-5 w-5 shrink-0" />
              <span className="sr-only">{server.name}</span>
            </Link>
          )
        })}
      </div>
    )
  }

  const rows = enabledServers.map((server) => {
    const path = getServerPath(server.id)

    return (
      <LinkedServerRow
        key={server.id}
        server={server}
        variant={variant}
        path={path}
        active={isActiveServerPath(location.pathname, path)}
        connected={statusById[server.id]?.connected ?? false}
        onNavigate={onNavigate}
      />
    )
  })

  if (variant === 'sheet') {
    return (
      <section aria-label="Servers" className="flex flex-col border-b border-border pb-1">
        <h2 className="px-4 pt-2 pb-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Servers
        </h2>
        {rows}
      </section>
    )
  }

  return (
    <SidebarSection label="Servers" collapsed={false}>
      {rows}
    </SidebarSection>
  )
}
