import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  mcpOAuthRedirectUri,
  type McpServerConfig,
  type McpTimeoutConfig,
} from '@opencode-manager/shared/opencode'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (serverId: string, config: McpServerConfig) => Promise<void>
  showConnectToggle?: boolean
}

interface KeyValueEntry {
  key: string
  value: string
}

function toRecord(entries: KeyValueEntry[]): Record<string, string> | undefined {
  const record = Object.fromEntries(
    entries
      .filter((entry) => entry.key.trim() && entry.value.trim())
      .map((entry) => [entry.key.trim(), entry.value.trim()]),
  )
  return Object.keys(record).length > 0 ? record : undefined
}

interface KeyValueRowsProps {
  label: string
  hint: string
  entries: KeyValueEntry[]
  onChange: (entries: KeyValueEntry[]) => void
  keyPlaceholder: string
  valuePlaceholder: string
}

function KeyValueRows({ label, hint, entries, onChange, keyPlaceholder, valuePlaceholder }: KeyValueRowsProps) {
  const updateEntry = (index: number, field: keyof KeyValueEntry, value: string) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className='h-6'
          aria-label={`Add ${label}`}
          onClick={() => onChange([...entries, { key: '', value: '' }])}
        >
          +
        </Button>
      </div>
      {entries.map((entry, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={entry.key}
            onChange={(e) => updateEntry(index, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            aria-label={`${label} name ${index + 1}`}
            className="bg-background border-border font-mono"
          />
          <Input
            value={entry.value}
            onChange={(e) => updateEntry(index, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            aria-label={`${label} value ${index + 1}`}
            className="bg-background border-border font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() => onChange(entries.filter((_, i) => i !== index))}
          >
            x
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export function AddMcpServerDialog({ open, onOpenChange, onSubmit, showConnectToggle = true }: AddMcpServerDialogProps) {
  const [serverId, setServerId] = useState('')
  const [serverType, setServerType] = useState<'local' | 'remote'>('local')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [environment, setEnvironment] = useState<KeyValueEntry[]>([])
  const [headers, setHeaders] = useState<KeyValueEntry[]>([])
  const [timeout, setTimeout] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthScope, setOauthScope] = useState('')
  
  const queryClient = useQueryClient()

  const buildTimeout = (): McpTimeoutConfig | undefined => {
    const parsed = parseInt(timeout)
    return Number.isFinite(parsed) ? { catalog: parsed, execution: parsed } : undefined
  }

  const buildMcpServerConfig = (): McpServerConfig => {
    const timeoutConfig = buildTimeout()

    if (serverType === 'local') {
      const commandArray = command.split(' ').filter((arg) => arg.trim())
      if (commandArray.length === 0) {
        throw new Error('Command is required for local MCP servers')
      }

      return {
        type: 'local',
        command: commandArray,
        environment: toRecord(environment),
        disabled: !enabled,
        timeout: timeoutConfig,
      }
    }

    if (!url.trim()) {
      throw new Error('URL is required for remote MCP servers')
    }

    return {
      type: 'remote',
      url: url.trim(),
      headers: toRecord(headers),
      oauth: oauthEnabled
        ? {
            client_id: oauthClientId.trim() || undefined,
            client_secret: oauthClientSecret.trim() || undefined,
            scope: oauthScope.trim() || undefined,
            redirect_uri: mcpOAuthRedirectUri(window.location.origin),
          }
        : false,
      disabled: !enabled,
      timeout: timeoutConfig,
    }
  }

  const addMcpServerMutation = useMutation({
    mutationFn: () => onSubmit(serverId, buildMcpServerConfig()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-status'] })
      handleClose()
    },
  })

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
    setHeaders([])
    setTimeout('')
    setEnabled(true)
    setOauthEnabled(false)
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthScope('')
    onOpenChange(false)
  }

  const isPending = addMcpServerMutation.isPending

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent mobileFullscreen className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>Add MCP Server</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <div className="space-y-4">
            <div className="space-y-1.5">
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

            <div className="space-y-1.5">
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
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
                      <Label htmlFor="oauthClientId">Client ID</Label>
                      <Input
                        id="oauthClientId"
                        value={oauthClientId}
                        onChange={(e) => setOauthClientId(e.target.value)}
                        placeholder="Optional"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
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
              <KeyValueRows
                label="Environment Variables"
                hint="Environment variables to set when running the MCP server"
                entries={environment}
                onChange={setEnvironment}
                keyPlaceholder="API_KEY"
                valuePlaceholder="your-api-key-here"
              />
            )}

            {serverType === 'remote' && (
              <KeyValueRows
                label="Headers"
                hint="HTTP headers sent with every request, for example Authorization: Bearer <token>. Turn OAuth off when authenticating with a token."
                entries={headers}
                onChange={setHeaders}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer your-token"
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                placeholder="5000"
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                Timeout in milliseconds for listing and calling tools
              </p>
            </div>

            {showConnectToggle && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor="enabled">Connect immediately after adding</Label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={handleClose} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!serverId || isPending}
            className="flex-1 sm:flex-none"
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add MCP Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
