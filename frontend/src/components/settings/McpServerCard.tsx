import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { XCircle, AlertCircle, Key, MoreVertical, Shield, Trash2, RefreshCw } from 'lucide-react'
import type { McpStatus, McpServerConfig } from '@/api/mcp'

interface McpServerCardProps {
  serverId: string
  serverConfig: McpServerConfig
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

function getStatusBadge(status: McpStatus) {
  switch (status.status) {
    case 'connected':
      return <Badge variant="default" className="text-xs bg-green-600">Connected</Badge>
    case 'disabled':
      return <Badge variant="secondary" className="text-xs">Disabled</Badge>
    case 'failed':
      return (
        <Badge variant="destructive" className="text-xs flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Failed
        </Badge>
      )
    case 'needs_auth':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-yellow-500 text-yellow-600">
          <Key className="h-3 w-3" />
          Auth Required
        </Badge>
      )
    case 'needs_client_registration':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-orange-500 text-orange-600">
          <AlertCircle className="h-3 w-3" />
          Registration Required
        </Badge>
      )
    default:
      return <Badge variant="outline" className="text-xs">Unknown</Badge>
  }
}

function getServerDisplayName(serverId: string): string {
  const name = serverId.replace(/[-_]/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function getServerDescription(serverConfig: McpServerConfig): string {
  if (serverConfig.type === 'local' && serverConfig.command) {
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
  } else if (serverConfig.type === 'remote' && serverConfig.url) {
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
  const isRemote = serverConfig.type === 'remote'
  const hasOAuthConfig = isRemote && !!serverConfig.oauth
  const hasOAuthError = status?.status === 'failed' && isRemote && /oauth|auth.*state/i.test(status.error)
  const isOAuthServer = hasOAuthConfig || hasOAuthError || (needsAuth && isRemote)
  const connectedWithOAuth = isOAuthServer && isConnected
  const showAuthButton = needsAuth || (isOAuthServer && status?.status === 'failed')
  const displayName = getServerDisplayName(serverId)

  return (
    <div className={`flex items-center justify-between gap-3 p-3 rounded-lg border bg-card ${errorMessage ? 'border-red-500/50' : 'border-border'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {connectedWithOAuth && (
            <span title="OAuth authenticated">
              <Shield className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          {status ? getStatusBadge(status) : (
            <Badge variant="outline" className="text-xs">Loading...</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {getServerDescription(serverConfig)}
        </p>
        {errorMessage && (
          <div className="flex items-start gap-1.5 mt-1.5 text-xs text-red-500">
            <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span className="break-words line-clamp-2">{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {showAuthButton && onAuthenticate ? (
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
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {showAuthButton && onAuthenticate && (
              <DropdownMenuItem onSelect={() => setTimeout(() => onAuthenticate(serverId), 0)}>
                <Key className="h-4 w-4 mr-2" />
                Authenticate
              </DropdownMenuItem>
            )}
            {connectedWithOAuth && onAuthenticate && (
              <DropdownMenuItem onSelect={() => setTimeout(() => onAuthenticate(serverId), 0)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Re-authenticate
              </DropdownMenuItem>
            )}
            {connectedWithOAuth && onRemoveAuth && (
              <DropdownMenuItem 
                onSelect={() => setTimeout(() => onRemoveAuth(serverId), 0)}
                disabled={isRemovingAuth}
              >
                <Shield className="h-4 w-4 mr-2" />
                {isRemovingAuth ? 'Removing...' : 'Remove Auth'}
              </DropdownMenuItem>
            )}
            {(showAuthButton || connectedWithOAuth) && <DropdownMenuSeparator />}
            <DropdownMenuItem 
              onSelect={() => {
                setTimeout(() => onDeleteServer(serverId, displayName), 0)
              }}
              className="text-red-600"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Server
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
