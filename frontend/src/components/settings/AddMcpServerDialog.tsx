import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
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
  
  const queryClient = useQueryClient()

  const addMcpServerMutation = useMutation({
    mutationFn: async () => {
      const config = await settingsApi.getDefaultOpenCodeConfig()
      if (!config) throw new Error('No default config found')
      
      const currentMcp = (config.content?.mcp as Record<string, any>) || {}
      
      const mcpConfig: any = {
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
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Configure a new Model Context Protocol server for your OpenCode configuration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
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

          <div className="space-y-2">
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
            <div className="space-y-2">
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
            <div className="space-y-2">
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

          {serverType === 'local' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Environment Variables</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddEnvironmentVar}
                >
                  Add Variable
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
                      ×
                    </Button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Environment variables to set when running the MCP server
              </p>
            </div>
          )}

          <div className="space-y-2">
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
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="enabled">Enable server on startup</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!serverId || addMcpServerMutation.isPending}
          >
            {addMcpServerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add MCP Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}