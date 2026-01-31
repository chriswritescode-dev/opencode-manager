import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, Plus, ExternalLink, Mail, Calendar, HardDrive, Briefcase, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { getGoogleMcpTemplates, type McpServerTemplate } from '@/lib/mcpServerTemplates'
import { useMcpServers } from '@/hooks/useMcpServers'
import { settingsApi } from '@/api/settings'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { showToast } from '@/lib/toast'

interface GoogleServiceCardProps {
  template: McpServerTemplate
  isConfigured: boolean
  status?: 'connected' | 'disabled' | 'failed' | 'needs_auth'
  onAdd: () => void
  onConnect: () => void
  onDisconnect: () => void
  isLoading?: boolean
}

function getServiceIcon(templateId: string) {
  switch (templateId) {
    case 'gmail':
      return Mail
    case 'google-calendar':
      return Calendar
    case 'google-drive':
      return HardDrive
    case 'google-workspace':
      return Briefcase
    default:
      return Briefcase
  }
}

function GoogleServiceCard({ 
  template, 
  isConfigured, 
  status, 
  onAdd, 
  onConnect, 
  onDisconnect,
  isLoading 
}: GoogleServiceCardProps) {
  const Icon = getServiceIcon(template.id)
  
  const getStatusBadge = () => {
    if (!isConfigured) return null
    
    switch (status) {
      case 'connected':
        return (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <CheckCircle2 className="h-3 w-3" />
            Connected
          </span>
        )
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        )
      case 'needs_auth':
        return (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <AlertCircle className="h-3 w-3" />
            Needs Auth
          </span>
        )
      case 'disabled':
        return (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Disabled
          </span>
        )
      default:
        return null
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{template.name}</CardTitle>
              {getStatusBadge()}
            </div>
          </div>
          {template.docsUrl && (
            <a 
              href={template.docsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="mb-4">{template.description}</CardDescription>
        
        {!isConfigured ? (
          <Button 
            onClick={onAdd} 
            size="sm" 
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Add Integration
          </Button>
        ) : (
          <div className="flex gap-2">
            {status === 'connected' ? (
              <Button 
                onClick={onDisconnect} 
                size="sm" 
                variant="outline"
                className="flex-1"
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Disconnect
              </Button>
            ) : (
              <Button 
                onClick={onConnect} 
                size="sm"
                className="flex-1"
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {status === 'needs_auth' ? 'Authenticate' : 'Connect'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface AddGoogleServiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: McpServerTemplate | null
  onSuccess: () => void
}

function AddGoogleServiceDialog({ open, onOpenChange, template, onSuccess }: AddGoogleServiceDialogProps) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const queryClient = useQueryClient()
  const { addServerAsync } = useMcpServers()

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error('No template selected')
      
      const config = await settingsApi.getDefaultOpenCodeConfig()
      if (!config) throw new Error('No default config found')

      const envVars: Record<string, string> = {}
      if (template.environment) {
        Object.keys(template.environment).forEach(key => {
          if (key.toLowerCase().includes('client_id')) {
            envVars[key] = clientId
          } else if (key.toLowerCase().includes('client_secret')) {
            envVars[key] = clientSecret
          }
        })
      }

      const mcpConfig = {
        type: template.type,
        enabled: true,
        command: template.command,
        environment: envVars,
      }

      const currentMcp = (config.content?.mcp as Record<string, unknown>) || {}
      const updatedConfig = {
        ...config.content,
        mcp: {
          ...currentMcp,
          [template.id]: mcpConfig,
        },
      }

      await settingsApi.updateOpenCodeConfig(config.name, { content: updatedConfig })
      
      await addServerAsync({
        name: template.id,
        config: {
          type: template.type,
          enabled: true,
          command: template.command,
          environment: envVars,
        }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      showToast.success(`${template?.name} added successfully`)
      handleClose()
      onSuccess()
    },
    onError: (error) => {
      showToast.error(`Failed to add ${template?.name}: ${error.message}`)
    }
  })

  const handleClose = () => {
    setClientId('')
    setClientSecret('')
    onOpenChange(false)
  }

  const handleAdd = () => {
    if (!clientId || !clientSecret) {
      showToast.error('Please enter both Client ID and Client Secret')
      return
    }
    addMutation.mutate()
  }

  if (!template) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {template.name}</DialogTitle>
          <DialogDescription>
            Configure Google OAuth credentials to connect {template.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 bg-muted/50 rounded-lg text-sm">
            <p className="font-medium mb-2">Setup Instructions:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Cloud Console</a></li>
              <li>Create a new OAuth 2.0 Client ID</li>
              <li>Set the redirect URI to your app callback URL</li>
              <li>Copy the Client ID and Client Secret below</li>
            </ol>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input
              id="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-abcdefg.apps.googleusercontent.com"
              className="bg-background border-border font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input
              id="clientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-..."
              className="bg-background border-border font-mono text-sm"
            />
          </div>

          {template.docsUrl && (
            <p className="text-xs text-muted-foreground">
              For detailed setup instructions, see the{' '}
              <a href={template.docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                documentation
              </a>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={addMutation.isPending || !clientId || !clientSecret}>
            {addMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add {template.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function IntegrationSettings() {
  const [selectedTemplate, setSelectedTemplate] = useState<McpServerTemplate | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  
  const queryClient = useQueryClient()
  const { 
    status: mcpStatus, 
    connect, 
    disconnect,
    authenticate,
    refetch: refetchStatus
  } = useMcpServers()

  const googleTemplates = getGoogleMcpTemplates()

  const isConfigured = (templateId: string): boolean => {
    return mcpStatus?.[templateId] !== undefined
  }

  const getStatus = (templateId: string) => {
    const status = mcpStatus?.[templateId]
    if (!status) return undefined
    return status.status as 'connected' | 'disabled' | 'failed' | 'needs_auth'
  }

  const handleAdd = (template: McpServerTemplate) => {
    setSelectedTemplate(template)
    setIsAddDialogOpen(true)
  }

  const handleConnect = async (templateId: string) => {
    setActionLoadingId(templateId)
    try {
      const status = mcpStatus?.[templateId]
      if (status?.status === 'needs_auth') {
        await authenticate(templateId)
      } else {
        await connect(templateId)
      }
      await refetchStatus()
    } catch (error) {
      showToast.error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleDisconnect = async (templateId: string) => {
    setActionLoadingId(templateId)
    try {
      await disconnect(templateId)
      await refetchStatus()
    } catch (error) {
      showToast.error(`Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
    refetchStatus()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Google Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect your Google account to enable AI-powered email, calendar, and drive management.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {googleTemplates.map((template) => (
          <GoogleServiceCard
            key={template.id}
            template={template}
            isConfigured={isConfigured(template.id)}
            status={getStatus(template.id)}
            onAdd={() => handleAdd(template)}
            onConnect={() => handleConnect(template.id)}
            onDisconnect={() => handleDisconnect(template.id)}
            isLoading={actionLoadingId === template.id}
          />
        ))}
      </div>

      <AddGoogleServiceDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        template={selectedTemplate}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
