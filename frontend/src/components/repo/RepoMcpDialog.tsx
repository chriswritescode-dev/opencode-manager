import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Loader2, XCircle, AlertCircle, Plug, Shield, MoreVertical, Key, RefreshCw } from 'lucide-react'
import { McpOAuthDialog } from '@/components/settings/McpOAuthDialog'
import { mcpApi, type McpStatus, type McpServerConfig, type McpAuthStartResponse } from '@/api/mcp'
import { useMutation } from '@tanstack/react-query'
import { showToast } from '@/lib/toast'

interface RepoMcpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: {
    content: Record<string, unknown>
  } | null
  directory: string | undefined
}

export function RepoMcpDialog({ open, onOpenChange, config, directory }: RepoMcpDialogProps) {
  const [localStatus, setLocalStatus] = useState<Record<string, McpStatus>>({})
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [removeAuthConfirmServer, setRemoveAuthConfirmServer] = useState<string | null>(null)
  const [authDialogServerId, setAuthDialogServerId] = useState<string | null>(null)
  
  const mcpServers = config?.content?.mcp as Record<string, McpServerConfig> | undefined || {}
  const serverIds = Object.keys(mcpServers)
  
  const fetchStatus = useCallback(async () => {
    if (!directory || serverIds.length === 0) return
    
    setIsLoadingStatus(true)
    try {
      const status = await mcpApi.getStatusFor(directory)
      setLocalStatus(status)
    } finally {
      setIsLoadingStatus(false)
    }
  }, [directory, serverIds.length])
  
  const toggleMutation = useMutation({
    mutationFn: async ({ serverId, enable }: { serverId: string; enable: boolean }) => {
      if (!directory) throw new Error('No directory provided')
      
      const currentStatus = localStatus[serverId]
      
      if (enable) {
        if (currentStatus?.status === 'needs_auth') {
          await mcpApi.authenticateDirectory(serverId, directory)
        } else {
          await mcpApi.connectDirectory(serverId, directory)
        }
      } else {
        await mcpApi.disconnectDirectory(serverId, directory)
      }
    },
    onSuccess: async () => {
      showToast.success('MCP server updated for this location')
      await fetchStatus()
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to update MCP server')
    },
  })

  const removeAuthMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!directory) throw new Error('No directory provided')
      await mcpApi.removeAuthDirectory(serverId, directory)
    },
    onSuccess: async () => {
      showToast.success('Authentication removed for this location')
      setRemoveAuthConfirmServer(null)
      await fetchStatus()
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to remove authentication')
    },
  })

  const handleOAuthAutoAuth = async () => {
    if (!authDialogServerId || !directory) return
    await mcpApi.authenticateDirectory(authDialogServerId, directory)
    await fetchStatus()
    setAuthDialogServerId(null)
  }

  const handleOAuthStartAuth = async (): Promise<McpAuthStartResponse> => {
    if (!authDialogServerId) throw new Error('No server ID')
    return await mcpApi.startAuth(authDialogServerId)
  }

  const handleOAuthCompleteAuth = async (code: string) => {
    if (!authDialogServerId) return
    await mcpApi.completeAuth(authDialogServerId, code)
    await fetchStatus()
    setAuthDialogServerId(null)
  }
  
  useEffect(() => {
    if (open && directory) {
      fetchStatus()
    }
  }, [open, directory, fetchStatus])
  
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
        return <Badge variant="default" className="text-xs bg-green-600">Connected</Badge>
      case 'disabled':
        return <Badge className="text-xs bg-gray-700 text-gray-300 border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">Disabled</Badge>
      case 'failed':
        return (
          <Badge variant="destructive" className="text-xs flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        )
      case 'needs_auth':
        return (
          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">
            Needs Auth
          </Badge>
        )
      default:
        return <Badge variant="outline" className="text-xs">Unknown</Badge>
    }
  }
  
  if (!directory) return null
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:inset-auto sm:left-[50%] sm:top-[50%] sm:w-[400px] sm:max-w-[400px] sm:h-auto sm:max-h-[80vh] flex flex-col gap-0 pb-safe">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 sm:pb-3 shrink-0 ">
          <DialogTitle>MCP for This Location</DialogTitle>
          <DialogDescription>
            Toggle MCP servers for this repository
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
          {serverIds.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Plug className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No MCP servers configured globally</p>
              <p className="text-xs mt-1">Add them in Settings first</p>
            </div>
          ) : isLoadingStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
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
                const isRemote = serverConfig.type === 'remote'
                const hasOAuthConfig = isRemote && !!serverConfig.oauth
                const hasOAuthError = failed && isRemote && /oauth|auth.*state/i.test(status.error)
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
                        {connectedWithOAuth && (
                          <span title="OAuth authenticated">
                            <Shield className="h-3 w-3 text-muted-foreground" />
                          </span>
                        )}
                        {getStatusBadge(status)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {getDescription(serverConfig)}
                      </p>
                      {failed && status.status === 'failed' && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-red-500">
                          <XCircle className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{status.error}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {showAuthButton ? (
                        <Button
                          onClick={() => setAuthDialogServerId(serverId)}
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
                      {(isOAuthServer || needsAuth) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {showAuthButton && (
                              <DropdownMenuItem onClick={() => setAuthDialogServerId(serverId)}>
                                <Key className="h-4 w-4 mr-2" />
                                Authenticate
                              </DropdownMenuItem>
                            )}
                            {connectedWithOAuth && (
                              <DropdownMenuItem onClick={() => setAuthDialogServerId(serverId)}>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Re-authenticate
                              </DropdownMenuItem>
                            )}
                            {connectedWithOAuth && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setRemoveAuthConfirmServer(serverId)}
                                  disabled={removeAuthMutation.isPending}
                                >
                                  <Shield className="h-4 w-4 mr-2" />
                                  {removeAuthMutation.isPending ? 'Removing...' : 'Remove Auth'}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DeleteDialog
          open={!!removeAuthConfirmServer}
          onOpenChange={() => setRemoveAuthConfirmServer(null)}
          onConfirm={() => {
            if (removeAuthConfirmServer) {
              removeAuthMutation.mutate(removeAuthConfirmServer)
            }
          }}
          onCancel={() => setRemoveAuthConfirmServer(null)}
          title="Remove Authentication"
          description="This will remove the OAuth credentials for this MCP server at this location. You will need to re-authenticate to use this server here again."
          itemName={removeAuthConfirmServer ? getDisplayName(removeAuthConfirmServer) : ''}
          isDeleting={removeAuthMutation.isPending}
        />

        <McpOAuthDialog
          open={!!authDialogServerId}
          onOpenChange={(o) => !o && setAuthDialogServerId(null)}
          serverName={authDialogServerId || ''}
          onAutoAuth={handleOAuthAutoAuth}
          onStartAuth={handleOAuthStartAuth}
          onCompleteAuth={handleOAuthCompleteAuth}
          directory={directory}
        />
      </DialogContent>
    </Dialog>
  )
}
