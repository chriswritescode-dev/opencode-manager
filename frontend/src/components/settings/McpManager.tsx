import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList } from '@/components/ui/settings-list'
import { Plus, Loader2, RefreshCw } from 'lucide-react'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { McpServerCard } from './McpServerCard'
import { McpOAuthDialog } from './McpOAuthDialog'
import { useMcpServers } from '@/hooks/useMcpServers'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import type { McpAuthStartResponse } from '@/api/mcp'
import { mcpApi } from '@/api/mcp'
import { mcpServersFromConfig } from '@opencode-manager/shared/opencode'
import { showToast } from '@/lib/toast'

interface McpManagerProps {
  config: {
    content: Record<string, unknown>
  } | null
  onUpdate: (content: Record<string, unknown>) => Promise<void>
}

function withoutMcpServer(mcp: unknown, serverId: string): Record<string, unknown> {
  const current = (mcp && typeof mcp === 'object' ? mcp : {}) as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  delete next[serverId]

  if (current.servers && typeof current.servers === 'object') {
    const servers = { ...(current.servers as Record<string, unknown>) }
    delete servers[serverId]
    next.servers = servers
  }

  return next
}

export function McpManager({ config, onUpdate }: McpManagerProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [deleteConfirmServer, setDeleteConfirmServer] = useState<{ id: string; name: string } | null>(null)
  const [togglingServerId, setTogglingServerId] = useState<string | null>(null)
  const [authDialogServerId, setAuthDialogServerId] = useState<string | null>(null)
  const [removeAuthConfirmServer, setRemoveAuthConfirmServer] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const {
    status: mcpStatus,
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
    connect,
    disconnect,
    removeAuthAsync,
    isRemovingAuth
  } = useMcpServers()

  const mcpServers = useMemo(() => mcpServersFromConfig(config?.content?.mcp), [config])

  const deleteServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (config) {
        await onUpdate({
          ...config.content,
          mcp: withoutMcpServer(config.content.mcp, serverId),
        })
      }

      await mcpApi.removeServer(serverId)
    },
    onSuccess: async () => {
      invalidateConfigCaches(queryClient)
      await refetchStatus()
      setDeleteConfirmServer(null)
    },
    onError: () => {
      showToast.error('Failed to delete MCP server')
    },
  })

  const isAnyOperationPending = deleteServerMutation.isPending || togglingServerId !== null

  const handleToggleServer = async (serverId: string) => {
    const currentStatus = mcpStatus?.[serverId]
    if (!currentStatus) return

    if (currentStatus.status === 'needs_auth') {
      setAuthDialogServerId(serverId)
      return
    }

    setTogglingServerId(serverId)
    try {
      if (currentStatus.status === 'connected') {
        await disconnect(serverId)
      } else {
        await connect(serverId)
      }
    } finally {
      setTogglingServerId(null)
      refetchStatus()
    }
  }

  const handleAuthenticate = (serverId: string) => {
    setAuthDialogServerId(serverId)
  }

  const handleOAuthStartAuth = async (): Promise<McpAuthStartResponse> => {
    if (!authDialogServerId) throw new Error('No server ID')
    return await mcpApi.startAuth(authDialogServerId)
  }

  const handleOAuthCheckStatus = async (): Promise<boolean> => {
    if (!authDialogServerId) return false
    const status = await mcpApi.getStatus()
    if (status[authDialogServerId]?.status === 'connected') {
      refetchStatus()
      return true
    }
    return false
  }

  const handleOAuthSuccess = () => {
    refetchStatus()
  }

  const handleRemoveAuth = (serverId: string) => {
    setRemoveAuthConfirmServer(serverId)
  }

  const handleConfirmRemoveAuth = async () => {
    if (removeAuthConfirmServer) {
      await removeAuthAsync(removeAuthConfirmServer)
      setRemoveAuthConfirmServer(null)
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
    if (status?.status === 'failed') return status.error ?? null
    return null
  }

  if (!config) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No OpenCode configuration file found.</p>
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
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchStatus()}
          disabled={isLoadingStatus}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Server
            </Button>
          </DialogTrigger>
          <AddMcpServerDialog 
            open={isAddDialogOpen} 
            onOpenChange={setIsAddDialogOpen}
            onUpdate={onUpdate}
          />
        </Dialog>
      </div>

      <SettingsList
        isLoading={false}
        error={null}
        isEmpty={Object.keys(mcpServers).length === 0}
        emptyTitle="No MCP servers configured"
        emptyHint="Add your first server to get started."
      >
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
              isRemovingAuth={isRemovingAuth}
              onToggleServer={handleToggleServer}
              onAuthenticate={handleAuthenticate}
              onRemoveAuth={handleRemoveAuth}
              onDeleteServer={(id, name) => setDeleteConfirmServer({ id, name })}
            />
          )
        })}
      </SettingsList>

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

      <McpOAuthDialog
        open={!!authDialogServerId}
        onOpenChange={(open) => !open && setAuthDialogServerId(null)}
        serverName={authDialogServerId || ''}
        onStartAuth={handleOAuthStartAuth}
        onCheckStatus={handleOAuthCheckStatus}
        onSuccess={handleOAuthSuccess}
      />

      <DeleteDialog
        open={!!removeAuthConfirmServer}
        onOpenChange={() => setRemoveAuthConfirmServer(null)}
        onConfirm={handleConfirmRemoveAuth}
        onCancel={() => setRemoveAuthConfirmServer(null)}
        title="Remove Authentication"
        description="This will remove the OAuth credentials for this MCP server. You will need to re-authenticate to use this server again."
        itemName={mcpServers[removeAuthConfirmServer || ''] ? getDisplayName(removeAuthConfirmServer || '') : ''}
        isDeleting={isRemovingAuth}
      />
    </div>
  )

  function getDisplayName(serverId: string): string {
    const name = serverId.replace(/[-_]/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
}
