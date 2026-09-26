import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Loader2, XCircle, AlertCircle, Plug, Shield, Key, RefreshCw, ChevronDown } from 'lucide-react'
import type { McpStatus } from '@/api/mcp'
import { formatMcpServerName } from '@/lib/mcp'
import { McpStatusBadge } from '@/components/settings/McpStatusBadge'

interface RepoMcpServerListProps {
  hasFetchedStatus: boolean
  serverIds: string[]
  isLoadingStatus: boolean
  localStatus: Record<string, McpStatus>
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
  toggleMutation,
  removeAuthMutation,
  onAuthClick,
  onRemoveAuthClick,
}: RepoMcpServerListProps) {
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
          <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {serverIds.map((serverId) => {
            const status = localStatus[serverId]
            const isConnected = status?.status === 'connected'
            const needsAuth = status?.status === 'needs_auth'
            const failed = status?.status === 'failed'
            const isOAuthServer = !!status?.integrationID
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
                      {formatMcpServerName(serverId)}
                    </p>
                    {(showAuthButton || connectedWithOAuth) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button 
                            className="cursor-pointer hover:bg-accent rounded inline-flex items-center gap-1"
                            title="Click for options"
                          >
                            {status?.status === 'connected' && (
                              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                Connected<ChevronDown className="h-3 w-3" />
                              </span>
                            )}
                            {status?.status === 'needs_auth' && (
                              <span className="text-xs border border-yellow-500 text-yellow-600 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                Needs Auth<ChevronDown className="h-3 w-3" />
                              </span>
                            )}
                            {status?.status === 'failed' && (
                              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />Failed<ChevronDown className="h-3 w-3" />
                              </span>
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
                      status && <McpStatusBadge status={status} />
                    )}
                  </div>
                  {failed && status.status === 'failed' && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-red-500">
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
