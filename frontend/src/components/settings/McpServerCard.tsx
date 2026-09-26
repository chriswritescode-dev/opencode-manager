import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { SettingsListRow, type SettingsListRowAction } from '@/components/ui/settings-list'
import { XCircle, Key, Shield, Trash2, RefreshCw } from 'lucide-react'
import type { McpStatus, McpServerConfig } from '@/api/mcp'
import { formatMcpServerName } from '@/lib/mcp'
import { McpStatusBadge } from './McpStatusBadge'

interface McpServerCardProps {
  serverId: string
  serverConfig?: McpServerConfig
  status?: McpStatus
  isConnected: boolean
  errorMessage: string | null
  isAnyOperationPending: boolean
  togglingServerId: string | null
  isRemovingAuth: boolean
  onToggleServer: (serverId: string) => void
  onAuthenticate?: (serverId: string) => void
  onRemoveAuth?: (serverId: string) => void
  onDeleteServer: (serverId: string, serverName: string) => void
}

function getServerDescription(serverConfig: McpServerConfig | undefined): string {
  if (serverConfig?.type === 'local') {
    const command = serverConfig.command.join(' ')
    if (command.includes('filesystem')) return 'File system access'
    if (command.includes('git')) return 'Git repository operations'
    if (command.includes('sqlite')) return 'SQLite database access'
    if (command.includes('postgres')) return 'PostgreSQL database access'
    if (command.includes('brave-search')) return 'Web search via Brave'
    if (command.includes('github')) return 'GitHub repository access'
    if (command.includes('slack')) return 'Slack integration'
    if (command.includes('puppeteer')) return 'Web automation'
    if (command.includes('fetch')) return 'HTTP requests'
    if (command.includes('memory')) return 'Persistent memory'
    return `Local command: ${command}`
  } else if (serverConfig?.type === 'remote') {
    return `Remote server: ${serverConfig.url}`
  }
  return 'MCP server'
}

export function McpServerCard({
  serverId,
  serverConfig,
  status,
  isConnected,
  errorMessage,
  isAnyOperationPending,
  togglingServerId,
  isRemovingAuth,
  onToggleServer,
  onAuthenticate,
  onRemoveAuth,
  onDeleteServer
}: McpServerCardProps) {
  const needsAuth = status?.status === 'needs_auth'
  const isOAuthServer = !!status?.integrationID
  const connectedWithOAuth = isOAuthServer && isConnected
  const showAuthButton = needsAuth || (isOAuthServer && status?.status === 'failed')
  const displayName = formatMcpServerName(serverId)

  const actions: SettingsListRowAction[] = []
  if (showAuthButton && onAuthenticate) {
    actions.push({ label: 'Authenticate', onClick: () => onAuthenticate(serverId), icon: <Key className="h-4 w-4 mr-2" /> })
  }
  if (connectedWithOAuth && onAuthenticate) {
    actions.push({ label: 'Re-authenticate', onClick: () => onAuthenticate(serverId), icon: <RefreshCw className="h-4 w-4 mr-2" /> })
  }
  if (connectedWithOAuth && onRemoveAuth) {
    actions.push({ label: isRemovingAuth ? 'Removing...' : 'Remove Auth', onClick: () => onRemoveAuth(serverId), icon: <Shield className="h-4 w-4 mr-2" />, disabled: isRemovingAuth })
  }
  actions.push({ label: 'Delete Server', onClick: () => onDeleteServer(serverId, displayName), icon: <Trash2 className="h-4 w-4 mr-2" />, destructive: true, separatorBefore: showAuthButton || connectedWithOAuth })

  return (
    <SettingsListRow
      title={displayName}
      badges={
        <>
          {connectedWithOAuth && (
            <span title="OAuth authenticated">
              <Shield className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          {status ? <McpStatusBadge status={status} /> : (
            <Badge variant="outline" className="text-xs">Loading...</Badge>
          )}
        </>
      }
      description={getServerDescription(serverConfig)}
      belowDescription={errorMessage ? (
        <div className="flex items-start gap-1.5 mt-1.5 text-xs text-red-500">
          <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span className="break-words line-clamp-2">{errorMessage}</span>
        </div>
      ) : undefined}
      trailing={
        showAuthButton && onAuthenticate ? (
          <Button
            onClick={() => onAuthenticate(serverId)}
            disabled={isAnyOperationPending || togglingServerId === serverId}
            variant="default"
            size="sm"
          >
            <Key className="h-3 w-3 mr-1" />
            Auth
          </Button>
        ) : (
          <Switch
            checked={isConnected}
            onCheckedChange={() => onToggleServer(serverId)}
            disabled={isAnyOperationPending || togglingServerId === serverId}
          />
        )
      }
      actions={actions}
      actionsLabel={`Actions for ${displayName}`}
    />
  )
}
