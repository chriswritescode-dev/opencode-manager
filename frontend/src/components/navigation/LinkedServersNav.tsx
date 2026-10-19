import { Check, ChevronDown, Laptop, Server, Settings2 } from 'lucide-react'
import {
  LOCAL_OPENCODE_SERVER_ID,
  type OpenCodeServer,
  type OpenCodeServerStatus,
} from '@opencode-manager/shared/schemas'
import { useOpenCodeServers, useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import { useLocalActivityState, useServerActivityState } from '@/hooks/useActiveWork'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSidebarServerSelection } from '@/hooks/useSidebarServerSelection'
import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type LinkedServersVariant = 'sidebar' | 'rail' | 'sheet'

interface LinkedServersNavProps {
  /** `sidebar` renders the full-width trigger row, `rail` the collapsed icon button, `sheet` the mobile sheet row. */
  variant?: LinkedServersVariant
}

type ActivityState = 'needs-input' | 'running' | null

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

function LocalActivityIndicator() {
  const activity = useLocalActivityState()

  return <ActivityStateIndicator state={activity} />
}

function ServerActivityIndicator({ serverId }: { serverId: string }) {
  const activity = useServerActivityState(serverId)

  return <ActivityStateIndicator state={activity} />
}

function AttentionDot({ activity, label }: { activity: ActivityState; label: string }) {
  if (activity === null) return null

  const needsInput = activity === 'needs-input'

  return (
    <span
      role="img"
      aria-label={needsInput ? `${label} needs input` : `${label} is running`}
      className={cn(
        'absolute inset-0 rounded-full',
        needsInput ? 'z-[2] bg-warning' : 'z-[1] bg-info',
      )}
    />
  )
}

function LocalAttentionDot() {
  const activity = useLocalActivityState()

  return <AttentionDot activity={activity} label="Local" />
}

function ServerAttentionDot({ server }: { server: OpenCodeServer }) {
  const activity = useServerActivityState(server.id)

  return <AttentionDot activity={activity} label={server.name} />
}

function OtherServersAttention({
  servers,
  selectedServerId,
}: {
  servers: OpenCodeServer[]
  selectedServerId: string
}) {
  const otherServers = servers.filter((server) => server.id !== selectedServerId)
  const showLocal = selectedServerId !== LOCAL_OPENCODE_SERVER_ID

  if (!showLocal && otherServers.length === 0) return null

  return (
    <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2">
      {showLocal && <LocalAttentionDot />}
      {otherServers.map((server) => (
        <ServerAttentionDot key={server.id} server={server} />
      ))}
    </span>
  )
}

function LocalServerMenuItem({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const activity = useLocalActivityState()

  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-current={active ? 'true' : undefined}
      className="gap-2"
    >
      <Laptop className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Local</span>
      <ActivityStateIndicator state={activity} />
      {active && <Check className="h-4 w-4 shrink-0" />}
    </DropdownMenuItem>
  )
}

function LinkedServerMenuItem({
  server,
  active,
  connected,
  onSelect,
}: {
  server: OpenCodeServer
  active: boolean
  connected: boolean
  onSelect: () => void
}) {
  const activity = useServerActivityState(server.id)

  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-current={active ? 'true' : undefined}
      className="gap-2"
    >
      <Server className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{server.name}</span>
      <ActivityStateIndicator state={activity} />
      <ServerConnectionDot connected={connected} />
      {active && <Check className="h-4 w-4 shrink-0" />}
    </DropdownMenuItem>
  )
}

function LinkedServersMenuContent({
  servers,
  selectedServerId,
  statusById,
  onSelect,
}: {
  servers: OpenCodeServer[]
  selectedServerId: string
  statusById: Record<string, OpenCodeServerStatus>
  onSelect: (serverId: string) => void
}) {
  const { setActiveTab } = useSettingsDialog()

  return (
    <DropdownMenuContent align="start" className="z-[300] w-56">
      <LocalServerMenuItem
        active={selectedServerId === LOCAL_OPENCODE_SERVER_ID}
        onSelect={() => onSelect(LOCAL_OPENCODE_SERVER_ID)}
      />
      {servers.map((server) => (
        <LinkedServerMenuItem
          key={server.id}
          server={server}
          active={selectedServerId === server.id}
          connected={statusById[server.id]?.connected ?? false}
          onSelect={() => onSelect(server.id)}
        />
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setActiveTab('servers')} className="gap-2">
        <Settings2 className="h-4 w-4 shrink-0" />
        <span>Manage servers…</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

/**
 * The server switcher. The trigger names the selected server and opens a menu that changes which
 * server's projects and sessions the sidebar lists; selecting never navigates. Hidden when no
 * linked server is enabled.
 */
export function LinkedServersNav({ variant = 'sidebar' }: LinkedServersNavProps) {
  const { servers, isLoading } = useOpenCodeServers()
  const { statusById } = useOpenCodeServerStatuses()
  const [selectedServerId, selectServer] = useSidebarServerSelection()
  const enabledServers = servers.filter((server) => server.enabled)

  if (isLoading || enabledServers.length === 0) {
    return null
  }

  const selectedServer = enabledServers.find((server) => server.id === selectedServerId)
  const localActive = selectedServerId === LOCAL_OPENCODE_SERVER_ID
  const selectedName = localActive ? 'Local' : selectedServer?.name ?? 'Local'
  const isRail = variant === 'rail'
  const connectionConnected = statusById[selectedServerId]?.connected ?? false

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch server, current: ${selectedName}`}
          className={cn(
            'flex items-center rounded-md text-sm text-foreground transition-colors duration-150',
            'hover:bg-accent/50',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isRail ? 'mx-auto h-9 w-9 justify-center' : 'h-9 w-full gap-2 px-2',
          )}
        >
          <span className="relative flex shrink-0">
            {localActive ? <Laptop className="h-4 w-4" /> : <Server className="h-4 w-4" />}
            <OtherServersAttention servers={enabledServers} selectedServerId={selectedServerId} />
          </span>
          {!isRail && <span className="min-w-0 flex-1 truncate text-left">{selectedName}</span>}
          {!isRail &&
            (localActive ? (
              <LocalActivityIndicator />
            ) : (
              <ServerActivityIndicator serverId={selectedServerId} />
            ))}
          {!isRail && !localActive && <ServerConnectionDot connected={connectionConnected} />}
          {!isRail && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        </button>
      </DropdownMenuTrigger>
      <LinkedServersMenuContent
        servers={enabledServers}
        selectedServerId={selectedServerId}
        statusById={statusById}
        onSelect={selectServer}
      />
    </DropdownMenu>
  )
}
