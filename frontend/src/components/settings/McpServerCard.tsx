import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Trash2, XCircle, AlertCircle, Key } from 'lucide-react'
import type { McpStatus } from '@/api/mcp'

interface McpServerConfig {
  type: 'local' | 'remote'
  enabled?: boolean
  command?: string[]
  url?: string
  environment?: Record<string, string>
  timeout?: number
}

interface McpServerCardProps {
  serverId: string
  serverConfig: McpServerConfig
  status?: McpStatus
  isConnected: boolean
  errorMessage: string | null
  isAnyOperationPending: boolean
  togglingServerId: string | null
  onToggleServer: (serverId: string) => void
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
  onToggleServer,
  onDeleteServer
}: McpServerCardProps) {
  return (
    <Card key={serverId} className={errorMessage ? 'border-red-500/50' : ''}>
<CardHeader className="pb-3">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{getServerDisplayName(serverId)}</CardTitle>
            <div className="flex items-center gap-2">
              {status ? getStatusBadge(status) : (
                <Badge variant="outline" className="text-xs">Loading...</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={isConnected}
              onCheckedChange={() => onToggleServer(serverId)}
              disabled={isAnyOperationPending || togglingServerId === serverId}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteServer(serverId, getServerDisplayName(serverId))}
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
}
