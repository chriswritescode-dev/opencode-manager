import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Loader2, XCircle, AlertCircle, Plug, Shield, Key, RefreshCw, ChevronDown } from 'lucide-react'
import type { McpStatus, McpServerConfig } from '@/api/mcp'


interface RepoMcpServerListProps {
  hasFetchedStatus: boolean
  serverIds: string[]
  isLoadingStatus: boolean
  localStatus: Record<string, McpStatus>
  mcpServers: Record<string, McpServerConfig>
  toggleMutation: {
    mutate: (variables: { serverId: string; enable: boolean }) => void
    isPending: boolean
  }
  removeAuthMutation: {
    mutate: (variables: string) => void
    isPending: boolean
  }
  onAuthClick: (serverId: string) => void
  onRemoveAuthClick: (serverId: string) => void
}

export function RepoMcpServerList({
  hasFetchedStatus,
  serverIds,
  isLoadingStatus,
  localStatus,
  mcpServers,
  toggleMutation,
  removeAuthMutation,
  onAuthClick,
  onRemoveAuthClick,
}: RepoMcpServerListProps) {
  const getDisplayName = (serverId: string): string => {
    const name = serverId.replace(/[-_]/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  const getDescription = (serverConfig: McpServerConfig): string => {
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
      return `Local: ${command}`
    } else if (serverConfig.type === 'remote' && serverConfig.url) {
      return serverConfig.url
    }
    return 'MCP server'
  }

  const getStatusBadge = (status?: McpStatus) => {
    if (!status) return null

    switch (status.status) {
      case 'connected':
        return <Badge variant="success" className="text-xs">Connected</Badge>
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
          <Badge variant="warning" className="text-xs">
            Needs Auth
          </Badge>
        )
      default:
        return <Badge variant="outline" className="text-xs">Unknown</Badge>
    }
  }

  return (
    <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
      {hasFetchedStatus && serverIds.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Plug className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No MCP servers configured for this location</p>
          <p className="text-xs mt-1">Add them in Settings or in the project's opencode.json</p>
        </div>
      ) : isLoadingStatus ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {serverIds.map((serverId) => {
            const serverConfig = mcpServers[serverId]
            const status = localStatus[serverId]
            const isConnected = status?.status === 'connected'
            const needsAuth = status?.status === 'needs_auth'
            const failed = status?.status === 'failed'
            const isRemote = serverConfig?.type === 'remote'
            const hasOAuthConfig = isRemote && !!serverConfig?.oauth
            const hasOAuthError = failed && isRemote && !!status?.error && /oauth|auth.*state/i.test(status.error)
            const isOAuthServer = hasOAuthConfig || hasOAuthError || (needsAuth && isRemote)
            const connectedWithOAuth = isOAuthServer && isConnected
            const showAuthButton = needsAuth || (isOAuthServer && failed)

            return (
              <div
                key={serverId}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium truncate">
                      {getDisplayName(serverId)}
                    </p>
                    {(showAuthButton || connectedWithOAuth) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button 
                            className="cursor-pointer hover:bg-accent rounded inline-flex items-center gap-1"
                            title="Click for options"
                          >
                            {status?.status === 'connected' && (
                              <Badge variant="success" className="gap-1 px-2 py-0.5 text-[11px]">
                                Connected<ChevronDown className="h-3 w-3" />
                              </Badge>
                            )}
                            {status?.status === 'needs_auth' && (
                              <Badge variant="warning" className="gap-1 px-2 py-0.5 text-[11px]">
                                Needs Auth<ChevronDown className="h-3 w-3" />
                              </Badge>
                            )}
                            {status?.status === 'failed' && (
                              <Badge variant="destructive" className="gap-1 px-2 py-0.5 text-[11px]">
                                <AlertCircle className="h-3 w-3" />Failed<ChevronDown className="h-3 w-3" />
                              </Badge>
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {showAuthButton && (
                            <DropdownMenuItem onClick={() => onAuthClick(serverId)}>
                              <Key className="h-4 w-4 mr-2" />
                              Authenticate
                            </DropdownMenuItem>
                          )}
                          {connectedWithOAuth && (
                            <DropdownMenuItem onClick={() => onAuthClick(serverId)}>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Re-authenticate
                            </DropdownMenuItem>
                          )}
                          {connectedWithOAuth && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => onRemoveAuthClick(serverId)}
                                disabled={removeAuthMutation.isPending}
                              >
                                <Shield className="h-4 w-4 mr-2" />
                                {removeAuthMutation.isPending ? 'Removing...' : 'Remove Auth'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      getStatusBadge(status)
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {serverConfig ? getDescription(serverConfig) : 'MCP server'}
                  </p>
                  {failed && status.status === 'failed' && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <XCircle className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{status.error}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {showAuthButton ? (
                    <Button
                      onClick={() => onAuthClick(serverId)}
                      disabled={toggleMutation.isPending}
                      variant="default"
                      size="sm"
                    >
                      <Key className="h-3 w-3 mr-1" />
                      Auth
                    </Button>
                  ) : (
                    <Switch
                      checked={isConnected}
                      disabled={toggleMutation.isPending || removeAuthMutation.isPending}
                      onCheckedChange={(enabled) => {
                        toggleMutation.mutate({ serverId, enable: enabled })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
