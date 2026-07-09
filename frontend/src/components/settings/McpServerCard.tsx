import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { SettingsListRow, type SettingsListRowAction } from '@/components/ui/settings-list'
import { XCircle, AlertCircle, Key, Shield, Trash2, RefreshCw } from 'lucide-react'
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

function getStatusBadge(status: McpStatus, t: ReturnType<typeof useTranslation>['t']) {
  switch (status.status) {
    case 'connected':
      return <Badge variant="default" className="text-xs bg-green-600">{t('common.connected')}</Badge>
    case 'disabled':
      return <Badge variant="secondary" className="text-xs">{t('common.disabled')}</Badge>
    case 'failed':
      return (
        <Badge variant="destructive" className="text-xs flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {t('common.failed')}
        </Badge>
      )
    case 'needs_auth':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-yellow-500 text-yellow-600">
          <Key className="h-3 w-3" />
          {t('mcp.authRequired') || 'Auth Required'}
        </Badge>
      )
    case 'needs_client_registration':
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1 border-orange-500 text-orange-600">
          <AlertCircle className="h-3 w-3" />
          {t('mcp.registrationRequired') || 'Registration Required'}
        </Badge>
      )
    default:
      return <Badge variant="outline" className="text-xs">{t('common.unknown')}</Badge>
  }
}

function getServerDisplayName(serverId: string): string {
  const name = serverId.replace(/[-_]/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function getServerDescription(serverConfig: McpServerConfig, t: ReturnType<typeof useTranslation>['t']): string {
  if (serverConfig.type === 'local' && serverConfig.command) {
    const command = serverConfig.command.join(' ')
    if (command.includes('filesystem')) return t('mcp.fileSystemAccess') || 'File system access'
    if (command.includes('git')) return 'Git repository operations'
    if (command.includes('sqlite')) return 'SQLite database access'
    if (command.includes('postgres')) return 'PostgreSQL database access'
    if (command.includes('brave-search')) return 'Web search via Brave'
    if (command.includes('github')) return 'GitHub repository access'
    if (command.includes('slack')) return 'Slack integration'
    if (command.includes('puppeteer')) return 'Web automation'
    if (command.includes('fetch')) return 'HTTP requests'
    if (command.includes('memory')) return 'Persistent memory'
    return `${t('mcp.localCommand') || 'Local command'}: ${command}`
  } else if (serverConfig.type === 'remote' && serverConfig.url) {
    return `${t('mcp.remoteServer') || 'Remote server'}: ${serverConfig.url}`
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
  const { t } = useTranslation()
  const needsAuth = status?.status === 'needs_auth'
  const isRemote = serverConfig.type === 'remote'
  const hasOAuthConfig = isRemote && !!serverConfig.oauth
  const hasOAuthError = status?.status === 'failed' && isRemote && /oauth|auth.*state/i.test(status.error)
  const isOAuthServer = hasOAuthConfig || hasOAuthError || (needsAuth && isRemote)
  const connectedWithOAuth = isOAuthServer && isConnected
  const showAuthButton = needsAuth || (isOAuthServer && status?.status === 'failed')
  const displayName = getServerDisplayName(serverId)

  const actions: SettingsListRowAction[] = []
  if (showAuthButton && onAuthenticate) {
    actions.push({ label: t('mcp.authenticate') || 'Authenticate', onClick: () => onAuthenticate(serverId), icon: <Key className="h-4 w-4 mr-2" /> })
  }
  if (connectedWithOAuth && onAuthenticate) {
    actions.push({ label: t('mcp.reauthenticate') || 'Re-authenticate', onClick: () => onAuthenticate(serverId), icon: <RefreshCw className="h-4 w-4 mr-2" /> })
  }
  if (connectedWithOAuth && onRemoveAuth) {
    actions.push({ label: isRemovingAuth ? t('common.removing') || 'Removing...' : t('mcp.removeAuth'), onClick: () => onRemoveAuth(serverId), icon: <Shield className="h-4 w-4 mr-2" />, disabled: isRemovingAuth })
  }
  actions.push({ label: t('mcpManager.deleteServer'), onClick: () => onDeleteServer(serverId, displayName), icon: <Trash2 className="h-4 w-4 mr-2" />, destructive: true, separatorBefore: showAuthButton || connectedWithOAuth })

  return (
    <SettingsListRow
      title={displayName}
      badges={
        <>
          {connectedWithOAuth && (
            <span title={t('mcp.oauthAuthenticated') || 'OAuth authenticated'}>
              <Shield className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          {status ? getStatusBadge(status, t) : (
            <Badge variant="outline" className="text-xs">{t('common.loading')}...</Badge>
          )}
        </>
      }
      description={getServerDescription(serverConfig, t)}
      belowDescription={errorMessage ? (
        <div className="flex items-start gap-1.5 mt-1.5 text-xs text-red-500">
          <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span className="break-words line-clamp-2">{errorMessage}</span>
        </div>
      ) : undefined}
      trailing={
        showAuthButton && onAuthenticate ? (
          <Button
            onClick={() => onAuthenticate(serverId)}
            disabled={isAnyOperationPending || togglingServerId === serverId}
            variant="default"
            size="sm"
          >
            <Key className="h-3 w-3 mr-1" />
            {t('mcp.auth') || 'Auth'}
          </Button>
        ) : (
          <Switch
            checked={isConnected}
            onCheckedChange={() => onToggleServer(serverId)}
            disabled={isAnyOperationPending || togglingServerId === serverId}
          />
        )
      }
      actions={actions}
      actionsLabel={`${t('common.actions')} ${t('for') || 'for'} ${displayName}`}
    />
  )
}
