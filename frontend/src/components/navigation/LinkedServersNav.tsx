import { Laptop, Server } from 'lucide-react'
import { LOCAL_OPENCODE_SERVER_ID, type OpenCodeServer } from '@opencode-manager/shared/schemas'
import { useOpenCodeServers, useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import { useLocalActivityState, useServerActivityState } from '@/hooks/useActiveWork'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'
import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { SidebarSection } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export type LinkedServersVariant = 'sidebar' | 'rail' | 'sheet'

interface LinkedServersNavProps {
  /** `sidebar` renders the labelled section, `rail` the collapsed icon column, `sheet` the mobile sheet group. */
  variant?: LinkedServersVariant
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

function rowClassName(active: boolean, variant: 'sidebar' | 'sheet') {
  return cn(
    'flex items-center gap-3 rounded-md p-2.5 text-sm transition-colors duration-150',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
    variant === 'sheet' && 'mx-2 p-2 text-left',
  )
}

function railClassName(active: boolean) {
  return cn(
    'flex items-center justify-center rounded-md p-2.5 transition-colors duration-150',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
  )
}

interface LocalServerRowProps {
  variant: 'sidebar' | 'sheet'
  active: boolean
  onSelect: () => void
}

function LocalServerRow({ variant, active, onSelect }: LocalServerRowProps) {
  const activity = useLocalActivityState()

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-current={active ? 'true' : undefined}
      className={rowClassName(active, variant)}
    >
      <Laptop className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Local</span>
      <ActivityStateIndicator state={activity} />
    </button>
  )
}

interface LinkedServerRowProps {
  server: OpenCodeServer
  variant: 'sidebar' | 'sheet'
  active: boolean
  connected: boolean
  onSelect: () => void
}

function LinkedServerRow({ server, variant, active, connected, onSelect }: LinkedServerRowProps) {
  const activity = useServerActivityState(server.id)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-current={active ? 'true' : undefined}
      className={rowClassName(active, variant)}
    >
      <Server className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{server.name}</span>
      <ActivityStateIndicator state={activity} />
      <ServerConnectionDot connected={connected} />
    </button>
  )
}

/**
 * The server switcher. Selecting a row changes which server's projects and sessions the sidebar
 * lists; it never navigates. Hidden when no linked server is enabled.
 */
export function LinkedServersNav({ variant = 'sidebar' }: LinkedServersNavProps) {
  const { servers, isLoading } = useOpenCodeServers()
  const { statusById } = useOpenCodeServerStatuses()
  const [selectedServerId, selectServer] = useSidebarServerSelection()
  const enabledServers = servers.filter((server) => server.enabled)
  const localActive = selectedServerId === LOCAL_OPENCODE_SERVER_ID

  if (isLoading || enabledServers.length === 0) {
    return null
  }

  if (variant === 'rail') {
    return (
      <div className="flex flex-col gap-1 px-2">
        <button
          type="button"
          onClick={() => selectServer(LOCAL_OPENCODE_SERVER_ID)}
          title="Local"
          aria-pressed={localActive}
          aria-current={localActive ? 'true' : undefined}
          className={railClassName(localActive)}
        >
          <Laptop className="h-5 w-5 shrink-0" />
          <span className="sr-only">Local</span>
        </button>
        {enabledServers.map((server) => {
          const active = selectedServerId === server.id

          return (
            <button
              key={server.id}
              type="button"
              onClick={() => selectServer(server.id)}
              title={server.name}
              aria-pressed={active}
              aria-current={active ? 'true' : undefined}
              className={railClassName(active)}
            >
              <Server className="h-5 w-5 shrink-0" />
              <span className="sr-only">{server.name}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const rows = [
    <LocalServerRow
      key={LOCAL_OPENCODE_SERVER_ID}
      variant={variant}
      active={localActive}
      onSelect={() => selectServer(LOCAL_OPENCODE_SERVER_ID)}
    />,
    ...enabledServers.map((server) => (
      <LinkedServerRow
        key={server.id}
        server={server}
        variant={variant}
        active={selectedServerId === server.id}
        connected={statusById[server.id]?.connected ?? false}
        onSelect={() => selectServer(server.id)}
      />
    )),
  ]

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
