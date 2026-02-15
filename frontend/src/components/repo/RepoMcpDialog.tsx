import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { RepoMcpServerList } from './RepoMcpServerList'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { McpOAuthDialog } from '@/components/settings/McpOAuthDialog'
import { mcpApi, type McpStatus, type McpServerConfig, type McpAuthStartResponse } from '@/api/mcp'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateSessionCaches } from '@/lib/queryInvalidation'
import { showToast } from '@/lib/toast'

interface RepoMcpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  directory: string | undefined
}

export function RepoMcpDialog({ open, onOpenChange, directory }: RepoMcpDialogProps) {
  const queryClient = useQueryClient()
  const [localStatus, setLocalStatus] = useState<Record<string, McpStatus>>({})
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({})
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [hasFetchedStatus, setHasFetchedStatus] = useState(false)
  const [removeAuthConfirmServer, setRemoveAuthConfirmServer] = useState<string | null>(null)
  const [authDialogServerId, setAuthDialogServerId] = useState<string | null>(null)
  
  const serverIds = Object.keys(localStatus)
  
  const fetchStatus = useCallback(async () => {
    if (!directory) return
    
    setIsLoadingStatus(true)
    try {
      const [status, config] = await Promise.all([
        mcpApi.getStatusFor(directory),
        mcpApi.getConfigForDirectory(directory),
      ])
      setLocalStatus(status)
      setMcpServers((config.mcp as Record<string, McpServerConfig>) || {})
      setHasFetchedStatus(true)
    } finally {
      setIsLoadingStatus(false)
    }
  }, [directory])
  
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
      invalidateSessionCaches(queryClient)
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
      invalidateSessionCaches(queryClient)
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to remove authentication')
    },
  })

  const handleOAuthStartAuth = async (): Promise<McpAuthStartResponse> => {
    if (!authDialogServerId) throw new Error('No server ID')
    const serverConfig = mcpServers[authDialogServerId]
    if (!serverConfig?.url) throw new Error('Server URL not found')
    const oauthConfig = typeof serverConfig.oauth === 'object' ? serverConfig.oauth : undefined
    return await mcpApi.startAuth(
      authDialogServerId,
      serverConfig.url,
      oauthConfig?.scope,
      oauthConfig?.clientId,
      oauthConfig?.clientSecret,
      directory,
    )
  }

  const handleOAuthCompleteAuth = async (code: string) => {
    if (!authDialogServerId) return
    await mcpApi.completeAuth(authDialogServerId, code)
    await fetchStatus()
    invalidateSessionCaches(queryClient)
    setAuthDialogServerId(null)
  }

  const handleOAuthCheckStatus = async (): Promise<boolean> => {
    if (!authDialogServerId || !directory) return false
    const status = await mcpApi.getStatusFor(directory)
    const serverStatus = status[authDialogServerId]
    if (serverStatus?.status === 'connected') {
      setLocalStatus(status)
      return true
    }
    return false
  }

  const handleOAuthSuccess = () => {
    fetchStatus()
    invalidateSessionCaches(queryClient)
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

  if (!directory) return null
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent mobileFullscreen className="sm:fixed sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[400px] sm:max-w-[400px] sm:h-auto sm:max-h-[80vh] flex flex-col gap-0 pb-safe">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 sm:pb-3 shrink-0 ">
          <DialogTitle>MCP for This Location</DialogTitle>
          <DialogDescription>
            Toggle MCP servers for this repository
          </DialogDescription>
        </DialogHeader>

        <RepoMcpServerList
          hasFetchedStatus={hasFetchedStatus}
          serverIds={serverIds}
          isLoadingStatus={isLoadingStatus}
          localStatus={localStatus}
          mcpServers={mcpServers}
          toggleMutation={toggleMutation}
          removeAuthMutation={removeAuthMutation}
          onAuthClick={setAuthDialogServerId}
          onRemoveAuthClick={setRemoveAuthConfirmServer}
        />

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
          onStartAuth={handleOAuthStartAuth}
          onCompleteAuth={handleOAuthCompleteAuth}
          onCheckStatus={handleOAuthCheckStatus}
          onSuccess={handleOAuthSuccess}
          directory={directory}
        />
      </DialogContent>
    </Dialog>
  )
}
