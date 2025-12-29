import { useState, useEffect, useCallback, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Plug, XCircle, AlertCircle, Search } from 'lucide-react'
import { mcpApi, type McpStatus } from '@/api/mcp'
import { useMutation } from '@tanstack/react-query'
import { showToast } from '@/lib/toast'

interface McpServerConfig {
  type: 'local' | 'remote'
  enabled?: boolean
  command?: string[]
  url?: string
  environment?: Record<string, string>
  timeout?: number
}

interface RepoMcpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: {
    content: Record<string, unknown>
  } | null
  directory: string | undefined
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
    return `Local: ${command}`
  } else if (serverConfig.type === 'remote' && serverConfig.url) {
    return `${serverConfig.url}`
  }
  return 'MCP server'
}

function getStatusBadge(status?: McpStatus) {
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

export function RepoMcpDialog({ open, onOpenChange, config, directory }: RepoMcpDialogProps) {
  const [localStatus, setLocalStatus] = useState<Record<string, McpStatus>>({})
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  
  const mcpServers = config?.content?.mcp as Record<string, McpServerConfig> | undefined || {}
  const serverIds = Object.keys(mcpServers)
  const filteredServerIds = serverIds.filter((serverId) => {
    const displayName = getServerDisplayName(serverId).toLowerCase()
    const description = getServerDescription(mcpServers[serverId]).toLowerCase()
    const query = searchQuery.toLowerCase()
    return displayName.includes(query) || description.includes(query)
  })
  
  const fetchStatus = useCallback(async () => {
    if (!directory || serverIds.length === 0) return
    
    setIsLoadingStatus(true)
    try {
      const status = await mcpApi.getStatusFor(directory)
      setLocalStatus(status)
    } catch (error) {
      console.error('Failed to fetch MCP status:', error)
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
  
  useEffect(() => {
    if (open && directory) {
      fetchStatus()
      searchInputRef.current?.focus()
    }
    if (!open) {
      setSearchQuery('')
    }
  }, [open, directory, serverIds.length, fetchStatus])
  
  if (!directory) return null
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95%] sm:max-w-[500px] p-0 gap-0 h-[90vh] sm:h-[80vh] flex flex-col">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 sm:pb-3 shrink-0 border-b border-border">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-muted-foreground" />
            <DialogTitle className="text-base sm:text-lg">MCP for This Location</DialogTitle>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Toggle MCP servers for this repository
          </p>
        </DialogHeader>
        
        <div className="px-4 sm:px-6 py-3 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search MCP servers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
          {serverIds.length === 0 ? (
            <div className="text-center py-6 sm:py-8">
              <Plug className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                No MCP servers configured globally
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Add them in Settings first
              </p>
            </div>
          ) : filteredServerIds.length === 0 ? (
              <div className="text-center py-6 sm:py-8">
                <Search className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  No MCP servers match "{searchQuery}"
                </p>
              </div>
            ) : isLoadingStatus ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredServerIds.map((serverId) => {
                const serverConfig = mcpServers[serverId]
                const status = localStatus[serverId]
                const isConnected = status?.status === 'connected'
                const failed = status?.status === 'failed'
                
                return (
                  <div
                    key={serverId}
                    className="flex items-center justify-between gap-3 p-2 sm:p-3 rounded-lg border border-border bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs sm:text-sm font-medium truncate">
                          {getServerDisplayName(serverId)}
                        </p>
                        {getStatusBadge(status)}
                      </div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                        {getServerDescription(serverConfig)}
                      </p>
                      {failed && status.status === 'failed' && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-red-500">
                          <XCircle className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{status.error}</span>
                        </div>
                      )}
                    </div>
                    
                    <Switch
                      checked={isConnected}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={(enabled) => {
                        toggleMutation.mutate({ serverId, enable: enabled })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
