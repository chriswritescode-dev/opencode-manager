import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, Globe, Terminal, Loader2, AlertCircle, RefreshCw, Key, XCircle } from 'lucide-react'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { useMcpServers } from '@/hooks/useMcpServers'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { McpStatus } from '@/api/mcp'

interface McpServerConfig {
  type: 'local' | 'remote'
  enabled?: boolean
  command?: string[]
  url?: string
  environment?: Record<string, string>
  timeout?: number
}

interface McpManagerProps {
  config: {
    name: string
    content: Record<string, unknown>
  } | null
  onUpdate: (content: Record<string, unknown>) => Promise<void>
  onConfigUpdate?: (configName: string, content: Record<string, unknown>) => Promise<void>
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

export function McpManager({ config, onUpdate, onConfigUpdate }: McpManagerProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [deleteConfirmServer, setDeleteConfirmServer] = useState<{ id: string; name: string } | null>(null)
  const [togglingServerId, setTogglingServerId] = useState<string | null>(null)
  
  const queryClient = useQueryClient()
  const { 
    status: mcpStatus, 
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
    connect,
    disconnect,
    authenticate,
    isToggling
  } = useMcpServers()

  const deleteServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!config) return
      
      const currentMcp = (config.content?.mcp as Record<string, McpServerConfig>) || {}
      const { [serverId]: _, ...rest } = currentMcp
      void _
      
      const updatedConfig = {
        ...config.content,
        mcp: rest,
      }
      
      await onUpdate(updatedConfig)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      setDeleteConfirmServer(null)
    },
  })

  const mcpServers = config?.content?.mcp as Record<string, McpServerConfig> || {}
  
  const isAnyOperationPending = deleteServerMutation.isPending || togglingServerId !== null || isToggling

  const handleToggleServer = async (serverId: string) => {
    const currentStatus = mcpStatus?.[serverId]
    if (!currentStatus) return
    
    setTogglingServerId(serverId)
    try {
      if (currentStatus.status === 'connected') {
        await disconnect(serverId)
      } else if (currentStatus.status === 'disabled') {
        await connect(serverId)
      } else if (currentStatus.status === 'needs_auth') {
        await authenticate(serverId)
      } else if (currentStatus.status === 'failed') {
        await connect(serverId)
      }
    } finally {
      setTogglingServerId(null)
      refetchStatus()
    }
  }

  const handleDeleteServer = () => {
    if (deleteConfirmServer) {
      deleteServerMutation.mutate(deleteConfirmServer.id)
    }
  }

  const getServerDisplayName = (serverId: string): string => {
    const name = serverId.replace(/[-_]/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  const getServerDescription = (serverConfig: McpServerConfig): string => {
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

  const getErrorMessage = (serverId: string): string | null => {
    const status = mcpStatus?.[serverId]
    if (!status) return null
    if (status.status === 'failed') return status.error
    if (status.status === 'needs_client_registration') return status.error
    return null
  }

  if (!config) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Select a configuration to manage MCP servers.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 relative min-h-[200px]">
      {isAnyOperationPending && (
        <div className="absolute inset-0 -m-4 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3 bg-card border border-border rounded-lg p-6 shadow-lg">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">
              {togglingServerId ? 'Updating MCP server...' : 'Processing...'}
            </span>
            <span className="text-xs text-muted-foreground">
              Please wait while we update your configuration
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">MCP Servers</h3>
          <p className="text-sm text-muted-foreground">
            Manage Model Context Protocol servers for {config.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6"
            onClick={() => refetchStatus()}
            disabled={isLoadingStatus}
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className='mr-1 h-6'>
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <AddMcpServerDialog 
              open={isAddDialogOpen} 
              onOpenChange={setIsAddDialogOpen}
              onUpdate={onConfigUpdate}
            />
          </Dialog>
        </div>
      </div>

      {Object.keys(mcpServers).length === 0 ? (
        <Card>
          <CardContent className="p-2 sm:p-8 text-center">
            <p className="text-muted-foreground">No MCP servers configured. Add your first server to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(mcpServers).map(([serverId, serverConfig]) => {
            const status = mcpStatus?.[serverId]
            const isConnected = status?.status === 'connected'
            const errorMessage = getErrorMessage(serverId)
            
            return (
              <Card key={serverId} className={errorMessage ? 'border-red-500/50' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {serverConfig.type === 'local' ? (
                          <Terminal className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        )}
                        <CardTitle className="text-base">{getServerDisplayName(serverId)}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        {status ? getStatusBadge(status) : (
                          <Badge variant="outline" className="text-xs">Loading...</Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {serverConfig.type}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isConnected}
                        onCheckedChange={() => handleToggleServer(serverId)}
                        disabled={isAnyOperationPending || togglingServerId === serverId}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmServer({ id: serverId, name: getServerDisplayName(serverId) })}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='p-2'>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>{getServerDescription(serverConfig)}</p>
                    {serverConfig.timeout && (
                      <p>Timeout: {serverConfig.timeout}ms</p>
                    )}
                    {serverConfig.environment && Object.keys(serverConfig.environment).length > 0 && (
                      <p>Environment variables: {Object.keys(serverConfig.environment).length} configured</p>
                    )}
                    {errorMessage && (
                      <div className="flex items-start gap-2 mt-2 p-2 bg-red-500/10 rounded text-red-600 text-xs">
                        <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span className="break-words">{errorMessage}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <DeleteDialog
        open={!!deleteConfirmServer}
        onOpenChange={() => setDeleteConfirmServer(null)}
        onConfirm={handleDeleteServer}
        onCancel={() => setDeleteConfirmServer(null)}
        title="Delete MCP Server"
        description="This will remove the MCP server configuration. This action cannot be undone."
        itemName={deleteConfirmServer?.name}
        isDeleting={deleteServerMutation.isPending}
      />
    </div>
  )
}
