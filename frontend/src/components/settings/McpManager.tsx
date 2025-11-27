import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, Globe, Terminal, Loader2 } from 'lucide-react'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface McpServerConfig {
  type: 'local' | 'remote'
  enabled: boolean
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

  const toggleServerMutation = useMutation({
    mutationFn: async ({ serverId, enabled }: { serverId: string; enabled: boolean }) => {
      if (!config) return
      
      setTogglingServerId(serverId)
      
      const currentMcp = (config.content?.mcp as Record<string, any>) || {}
      const serverConfig = currentMcp[serverId]
      
      if (!serverConfig) return
      
      const updatedConfig = {
        ...config.content,
        mcp: {
          ...currentMcp,
          [serverId]: {
            ...serverConfig,
            enabled,
          },
        },
      }
      
      await onUpdate(updatedConfig)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
    },
    onSettled: () => {
      setTogglingServerId(null)
    },
  })

  const deleteServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!config) return
      
      const currentMcp = (config.content?.mcp as Record<string, any>) || {}
      const { [serverId]: deleted, ...rest } = currentMcp
      
      const updatedConfig = {
        ...config.content,
        mcp: rest,
      }
      
      await onUpdate(updatedConfig)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
      setDeleteConfirmServer(null)
    },
  })

  const mcpServers = config?.content?.mcp as Record<string, McpServerConfig> || {}
  
  const isAnyOperationPending = toggleServerMutation.isPending || deleteServerMutation.isPending || togglingServerId !== null

  const handleToggleServer = (serverId: string, enabled: boolean) => {
    toggleServerMutation.mutate({ serverId, enabled })
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
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Server
            </Button>
          </DialogTrigger>
          <AddMcpServerDialog 
            open={isAddDialogOpen} 
            onOpenChange={setIsAddDialogOpen}
            onUpdate={onConfigUpdate}
          />
        </Dialog>
      </div>

      {Object.keys(mcpServers).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No MCP servers configured. Add your first server to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {Object.entries(mcpServers).map(([serverId, serverConfig]) => (
            <Card key={serverId}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
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
                      <Badge variant={serverConfig.enabled ? 'default' : 'secondary'} className="text-xs">
                        {serverConfig.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {serverConfig.type}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={serverConfig.enabled}
                      onCheckedChange={(enabled) => handleToggleServer(serverId, enabled)}
                      disabled={isAnyOperationPending}
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
              <CardContent>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>{getServerDescription(serverConfig)}</p>
                  {serverConfig.timeout && (
                    <p>Timeout: {serverConfig.timeout}ms</p>
                  )}
                  {serverConfig.environment && Object.keys(serverConfig.environment).length > 0 && (
                    <p>Environment variables: {Object.keys(serverConfig.environment).length} configured</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
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