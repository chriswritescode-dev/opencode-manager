import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useMcpServers } from '@/hooks/useMcpServers'
import { settingsApi } from '@/api/settings'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  configName?: string
  onUpdate?: (configName: string, content: Record<string, unknown>) => Promise<void>
}

interface EnvironmentVariable {
  key: string
  value: string
}

export function AddMcpServerDialog({ open, onOpenChange, onUpdate }: AddMcpServerDialogProps) {
  const [serverId, setServerId] = useState('')
  const [serverType, setServerType] = useState<'local' | 'remote'>('local')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [environment, setEnvironment] = useState<EnvironmentVariable[]>([])
  const [timeout, setTimeout] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthScope, setOauthScope] = useState('')
  
  const queryClient = useQueryClient()
  const { addServerAsync, isAddingServer } = useMcpServers()

  const addMcpServerMutation = useMutation({
    mutationFn: async () => {
      const config = await settingsApi.getDefaultOpenCodeConfig()
      if (!config) throw new Error('No default config found')
      
      const currentMcp = (config.content?.mcp as Record<string, unknown>) || {}
      
      const mcpConfig: Record<string, unknown> = {
        type: serverType,
        enabled,
      }

      if (serverType === 'local') {
        const commandArray = command.split(' ').filter(arg => arg.trim())
        if (commandArray.length === 0) {
          throw new Error('Command is required for local MCP servers')
        }
        mcpConfig.command = commandArray
        
        const envVars: Record<string, string> = {}
        environment.forEach(env => {
          if (env.key.trim() && env.value.trim()) {
            envVars[env.key.trim()] = env.value.trim()
          }
        })
        if (Object.keys(envVars).length > 0) {
          mcpConfig.environment = envVars
        }
      } else {
        if (!url.trim()) {
          throw new Error('URL is required for remote MCP servers')
        }
        mcpConfig.url = url.trim()
        
        if (oauthEnabled) {
          const oauthConfig: Record<string, string> = {}
          if (oauthClientId.trim()) oauthConfig.clientId = oauthClientId.trim()
          if (oauthClientSecret.trim()) oauthConfig.clientSecret = oauthClientSecret.trim()
          if (oauthScope.trim()) oauthConfig.scope = oauthScope.trim()
          mcpConfig.oauth = Object.keys(oauthConfig).length > 0 ? oauthConfig : true
        }
      }

      if (timeout && parseInt(timeout)) {
        mcpConfig.timeout = parseInt(timeout)
      }

      const updatedConfig = {
        ...config.content,
        mcp: {
          ...currentMcp,
          [serverId]: mcpConfig,
        },
      }

      await settingsApi.updateOpenCodeConfig(config.name, { content: updatedConfig })
      
      if (enabled) {
        const buildOauthField = () => {
          if (serverType !== 'remote' || !oauthEnabled) return undefined
          const cfg: Record<string, string> = {}
          if (oauthClientId.trim()) cfg.clientId = oauthClientId.trim()
          if (oauthClientSecret.trim()) cfg.clientSecret = oauthClientSecret.trim()
          if (oauthScope.trim()) cfg.scope = oauthScope.trim()
          return Object.keys(cfg).length > 0 ? cfg : true
        }

        await addServerAsync({ 
          name: serverId, 
          config: {
            type: serverType,
            enabled,
            command: serverType === 'local' ? command.split(' ').filter(arg => arg.trim()) : undefined,
            url: serverType === 'remote' ? url.trim() : undefined,
            environment: serverType === 'local' && Object.keys(environment).length > 0 
              ? environment.reduce((acc, env) => {
                  if (env.key.trim() && env.value.trim()) {
                    acc[env.key.trim()] = env.value.trim()
                  }
                  return acc
                }, {} as Record<string, string>)
              : undefined,
            timeout: timeout && parseInt(timeout) ? parseInt(timeout) : undefined,
            oauth: buildOauthField(),
          }
        })
      }
    },
    onSuccess: async () => {
      if (onUpdate) {
        const config = await settingsApi.getDefaultOpenCodeConfig()
        if (config) {
          await onUpdate(config.name, config.content)
        }
      } else {
        queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
      }
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      handleClose()
    },
  })

  const handleAddEnvironmentVar = () => {
    setEnvironment([...environment, { key: '', value: '' }])
  }

  const handleRemoveEnvironmentVar = (index: number) => {
    setEnvironment(environment.filter((_, i) => i !== index))
  }

  const handleUpdateEnvironmentVar = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...environment]
    updated[index][field] = value
    setEnvironment(updated)
  }

  const handleAdd = () => {
    if (serverId) {
      addMcpServerMutation.mutate()
    }
  }

  const handleClose = () => {
    setServerId('')
    setServerType('local')
    setCommand('')
    setUrl('')
    setEnvironment([])
    setTimeout('')
    setEnabled(true)
    setOauthEnabled(false)
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthScope('')
    onOpenChange(false)
  }

  const isPending = addMcpServerMutation.isPending || isAddingServer

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent mobileFullscreen className="sm:inset-auto sm:left-[50%] sm:top-[50%] sm:w-[95vw] sm:max-w-3xl sm:h-auto sm:max-h-[90vh] flex flex-col gap-0 bg-card border-border pb-safe">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 sm:pb-3 shrink-0">
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Configure a new Model Context Protocol server for your OpenCode configuration
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-3 sm:py-4">
          <div className="space-y-4">
            <div>
              <Label htmlFor="serverId">Server ID</Label>
              <Input
                id="serverId"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                placeholder="e.g., filesystem, git, my-server"
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                Unique identifier for this MCP server (lowercase, no spaces)
              </p>
            </div>

            <div>
              <Label htmlFor="serverType">Server Type</Label>
              <Select value={serverType} onValueChange={(value: 'local' | 'remote') => setServerType(value)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local (Command)</SelectItem>
                  <SelectItem value="remote">Remote (HTTP)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {serverType === 'local' ? (
              <div>
                <Label htmlFor="command">Command</Label>
                <Input
                  id="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx @modelcontextprotocol/server-filesystem /tmp"
                  className="bg-background border-border font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Command and arguments to run the MCP server
                </p>
              </div>
            ) : (
              <div>
                <Label htmlFor="url">Server URL</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:3000/mcp"
                  className="bg-background border-border font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  URL of the remote MCP server
                </p>
              </div>
            )}

            {serverType === 'remote' && (
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="oauth"
                    checked={oauthEnabled}
                    onCheckedChange={setOauthEnabled}
                  />
                  <Label htmlFor="oauth">Enable OAuth</Label>
                </div>
                {oauthEnabled && (
                  <div className="space-y-3 pl-4 border-l-2 border-border">
                    <p className="text-xs text-muted-foreground">
                      Leave fields blank to use the server's default OAuth discovery
                    </p>
                    <div>
                      <Label htmlFor="oauthClientId">Client ID</Label>
                      <Input
                        id="oauthClientId"
                        value={oauthClientId}
                        onChange={(e) => setOauthClientId(e.target.value)}
                        placeholder="Optional"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div>
                      <Label htmlFor="oauthClientSecret">Client Secret</Label>
                      <Input
                        id="oauthClientSecret"
                        type="password"
                        value={oauthClientSecret}
                        onChange={(e) => setOauthClientSecret(e.target.value)}
                        placeholder="Optional"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div>
                      <Label htmlFor="oauthScope">Scope</Label>
                      <Input
                        id="oauthScope"
                        value={oauthScope}
                        onChange={(e) => setOauthScope(e.target.value)}
                        placeholder="e.g., read write"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {serverType === 'local' && (
              <div>
                <div className="flex items-center justify-between">
                  <Label>Environment Variables</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className='h-6'
                    onClick={handleAddEnvironmentVar}
                  >
                    +
                  </Button>
                </div>
                {environment.map((env, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={env.key}
                      onChange={(e) => handleUpdateEnvironmentVar(index, 'key', e.target.value)}
                      placeholder="API_KEY"
                      className="bg-background border-border font-mono"
                    />
                    <Input
                      value={env.value}
                      onChange={(e) => handleUpdateEnvironmentVar(index, 'value', e.target.value)}
                      placeholder="your-api-key-here"
                      className="bg-background border-border font-mono"
                    />
                    {environment.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleRemoveEnvironmentVar(index)}
                      >
                        x
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Environment variables to set when running the MCP server
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                placeholder="5000"
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                Timeout in milliseconds for fetching tools (default: 5000)
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="enabled">Connect immediately after adding</Label>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2 w-full px-4 sm:px-6 pb-4 sm:pb-6 pt-3 shrink-0 border-t border-border gap-2">
          <Button variant="outline" onClick={handleClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!serverId || isPending}
            className="flex-1"
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add MCP Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
