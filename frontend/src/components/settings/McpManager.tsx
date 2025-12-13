import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Loader2, RefreshCw } from 'lucide-react'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { McpServerCard } from './McpServerCard'
import { useMcpServers } from '@/hooks/useMcpServers'
import { useMutation, useQueryClient } from '@tanstack/react-query'

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
              <McpServerCard
                key={serverId}
                serverId={serverId}
                serverConfig={serverConfig}
                status={status}
                isConnected={isConnected}
                errorMessage={errorMessage}
                isAnyOperationPending={isAnyOperationPending}
                togglingServerId={togglingServerId}
                onToggleServer={handleToggleServer}
                onDeleteServer={(id, name) => setDeleteConfirmServer({ id, name })}
              />
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
