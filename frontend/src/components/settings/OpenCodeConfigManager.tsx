import { useState, useEffect, useRef } from 'react'
import { Loader2, Plus, Trash2, Edit, Star, StarOff, Download, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import { CommandsEditor } from './CommandsEditor'
import { AgentsEditor } from './AgentsEditor'
import { McpManager } from './McpManager'
import { settingsApi } from '@/api/settings'
import { useMutation } from '@tanstack/react-query'

interface OpenCodeConfig {
  id: number
  name: string
  content: Record<string, unknown>
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export function OpenCodeConfigManager() {
  const [configs, setConfigs] = useState<OpenCodeConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editingConfig, setEditingConfig] = useState<OpenCodeConfig | null>(null)
  const [selectedConfig, setSelectedConfig] = useState<OpenCodeConfig | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    commands: false,
    agents: false,
    mcp: false,
  })
  const [newConfigName, setNewConfigName] = useState('')
  const [newConfigContent, setNewConfigContent] = useState('')
  const [newConfigIsDefault, setNewConfigIsDefault] = useState(false)
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [deleteConfirmConfig, setDeleteConfirmConfig] = useState<OpenCodeConfig | null>(null)
  const [createError, setCreateError] = useState('')
  const [createErrorLine, setCreateErrorLine] = useState<number | null>(null)
  const createTextareaRef = useRef<HTMLTextAreaElement>(null)
  
  const restartServerMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.restartOpenCodeServer()
    },
    onSuccess: (data) => {
      console.log('OpenCode server restarted successfully:', data.message)
    },
    onError: (error) => {
      console.error('Failed to restart OpenCode server:', error)
    },
  })

  const fetchConfigs = async () => {
    try {
      setIsLoading(true)
      const data = await settingsApi.getOpenCodeConfigs()
      setConfigs(data.configs)
    } catch (error) {
      console.error('Failed to fetch configs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const updateConfigContent = async (configName: string, newContent: Record<string, unknown>) => {
    try {
      setIsUpdating(true)
      await settingsApi.updateOpenCodeConfig(configName, { content: newContent })
      
      // Update the local state
      setConfigs(prev => prev.map(config => 
        config.name === configName 
          ? { ...config, content: newContent, updatedAt: Date.now() }
          : config
      ))
      
      // Update selected config if it's the one being edited
      if (selectedConfig && selectedConfig.name === configName) {
        setSelectedConfig({ ...selectedConfig, content: newContent, updatedAt: Date.now() })
      }
    } catch (error) {
      console.error('Failed to update config:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  useEffect(() => {
    if (configs.length > 0 && !selectedConfig) {
      const defaultConfig = configs.find(config => config.isDefault)
      setSelectedConfig(defaultConfig || configs[0])
    }
  }, [configs, selectedConfig])

  const createConfig = async () => {
    if (!newConfigName.trim() || !newConfigContent.trim()) return

    try {
      setIsUpdating(true)
      setCreateError('')
      const content = JSON.parse(newConfigContent)
      
      const forbiddenFields = ['id', 'createdAt', 'updatedAt']
      const foundForbidden = forbiddenFields.filter(field => field in content)
      if (foundForbidden.length > 0) {
        throw new Error(`Invalid fields found: ${foundForbidden.join(', ')}. These fields are managed automatically.`)
      }
      
      await settingsApi.createOpenCodeConfig({
        name: newConfigName.trim(),
        content,
        isDefault: newConfigIsDefault,
      })
      
      setNewConfigName('')
      setNewConfigContent('')
      setNewConfigIsDefault(false)
      setIsCreateDialogOpen(false)
      fetchConfigs()
    } catch (error) {
      if (error instanceof SyntaxError) {
        const match = error.message.match(/line (\d+)/i)
        const line = match ? parseInt(match[1]) : null
        setCreateErrorLine(line)
        setCreateError(`JSON Error: ${error.message}`)
        if (line && createTextareaRef.current) {
          highlightErrorLine(createTextareaRef.current, line)
        }
      } else if (error instanceof Error) {
        setCreateError(error.message)
        setCreateErrorLine(null)
      } else {
        setCreateError('Failed to create configuration')
        setCreateErrorLine(null)
      }
      console.error('Failed to create config:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  

  const deleteConfig = async (config: OpenCodeConfig) => {
    try {
      setIsUpdating(true)
      await settingsApi.deleteOpenCodeConfig(config.name)
      setDeleteConfirmConfig(null)
      fetchConfigs()
    } catch (error) {
      console.error('Failed to delete config:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const setDefaultConfig = async (config: OpenCodeConfig) => {
    try {
      setIsUpdating(true)
      await settingsApi.setDefaultOpenCodeConfig(config.name)
      fetchConfigs()
    } catch (error) {
      console.error('Failed to set default config:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const uploadConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      try {
        JSON.parse(content)
        setNewConfigContent(content)
        setNewConfigName(file.name.replace('.json', '').replace('.jsonc', ''))
      } catch {
        window.alert('Invalid JSON file')
      }
    }
    reader.readAsText(file)
  }

  const downloadConfig = (config: OpenCodeConfig) => {
    const blob = new Blob([JSON.stringify(config.content, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const highlightErrorLine = (textarea: HTMLTextAreaElement, line: number) => {
    const lines = textarea.value.split('\n')
    if (line > lines.length) return
    
    let charIndex = 0
    for (let i = 0; i < line - 1; i++) {
      charIndex += lines[i].length + 1
    }
    
    textarea.focus()
    textarea.setSelectionRange(charIndex, charIndex + lines[line - 1].length)
  }

  const startEdit = (config: OpenCodeConfig) => {
    setEditingConfig(config)
    setIsEditDialogOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">OpenCode Configurations</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => restartServerMutation.mutate()}
            disabled={restartServerMutation.isPending}
          >
            {restartServerMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Restart Server
          </Button>
<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Config
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create OpenCode Config</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="config-name">Config Name</Label>
                <Input
                  id="config-name"
                  value={newConfigName}
                  onChange={(e) => setNewConfigName(e.target.value)}
                  placeholder="my-config"
                />
              </div>
              
              <div>
                <Label htmlFor="config-upload">Upload JSON File</Label>
                <Input
                  id="config-upload"
                  type="file"
                  accept=".json,.jsonc"
                  onChange={uploadConfig}
                />
              </div>

              <div>
                <Label htmlFor="config-content">Config Content (JSON)</Label>
                <Textarea
                  id="config-content"
                  ref={createTextareaRef}
                  value={newConfigContent}
                  onChange={(e) => {
                    setNewConfigContent(e.target.value)
                    setCreateError('')
                    setCreateErrorLine(null)
                  }}
                  placeholder='{"$schema": "https://opencode.ai/config.json", "theme": "dark"}'
                  rows={20}
                  className="font-mono text-sm"
                />
                {createError && (
                  <p className="text-sm text-red-500 mt-2">
                    {createError}
                    {createErrorLine && (
                      <span className="ml-2 text-xs">(Line {createErrorLine})</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="config-default"
                  checked={newConfigIsDefault}
                  onCheckedChange={setNewConfigIsDefault}
                />
                <Label htmlFor="config-default">Set as default configuration</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={createConfig} disabled={isUpdating || !newConfigName.trim() || !newConfigContent.trim()}>
                  {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {configs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No OpenCode configurations found. Create your first config to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{config.name}</CardTitle>
                    {config.isDefault && (
                      <Badge variant="default" className="text-xs">
                        <Star className="h-3 w-3 mr-1" />
                        Default
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => downloadConfig(config)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(config)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDefaultConfig(config)}
                      disabled={config.isDefault || isUpdating}
                    >
                      {config.isDefault ? (
                        <StarOff className="h-4 w-4" />
                      ) : (
                        <Star className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirmConfig(config)}
                      className="text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  <p>Updated: {new Date(config.updatedAt).toLocaleString()}</p>
                  <p>Created: {new Date(config.createdAt).toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <OpenCodeConfigEditor
        config={editingConfig}
        isOpen={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        onUpdate={async (content) => {
          if (!editingConfig) return
          await settingsApi.updateOpenCodeConfig(editingConfig.name, { content })
          await fetchConfigs()
        }}
        isUpdating={isUpdating}
      />

      {/* Commands, Agents, and MCP Section */}
      <div className="mt-8 space-y-6">
        <div className="border-t border-border pt-6">
          <h3 className="text-lg font-semibold mb-4">Configure Commands, Agents & MCP Servers</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Add custom commands, agents, and MCP servers to your OpenCode configurations. Select a configuration below to edit its settings.
          </p>
          
          {configs.length > 0 && (
            <div className="space-y-6">
              <div className='px-1'>
                <Label className="text-base font-medium">Select Configuration to Edit</Label>
                <Select 
                  onValueChange={(value) => {
                    const config = configs.find(c => c.name === value)
                    setSelectedConfig(config || null)
                  }}
                  value={selectedConfig?.name || ""}
                >
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="Select a configuration..." />
                  </SelectTrigger>
                  <SelectContent>
                    {configs.map(config => (
                      <SelectItem key={config.id} value={config.name}>
                        {config.name} {config.isDefault && '(Default)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex flex-col gap-4 pb-20">
                {selectedConfig ? (
                  <>
                    <div className="bg-card border border-border rounded-lg overflow-hidden">
                      <button
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedSections(prev => ({ ...prev, commands: !prev.commands }))}
                      >
                        <div className="flex items-center gap-3">
                          <h4 className="text-sm font-medium">Commands</h4>
                          <span className="text-xs text-muted-foreground">
                            {Object.keys(selectedConfig.content.command as Record<string, any> || {}).length} configured
                          </span>
                        </div>
                        <Edit className={`h-4 w-4 transition-transform ${expandedSections.commands ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.commands ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-4 max-h-[50vh] overflow-y-auto">
                          <CommandsEditor
                            commands={(selectedConfig.content.command as Record<string, any>) || {}}
                            onChange={(commands) => {
                              const updatedContent = {
                                ...selectedConfig.content,
                                command: commands
                              }
                              updateConfigContent(selectedConfig.name, updatedContent)
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-card border border-border rounded-lg overflow-hidden">
                      <button
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedSections(prev => ({ ...prev, agents: !prev.agents }))}
                      >
                        <div className="flex items-center gap-3">
                          <h4 className="text-sm font-medium">Agents</h4>
                          <span className="text-xs text-muted-foreground">
                            {Object.keys(selectedConfig.content.agent as Record<string, any> || {}).length} configured
                          </span>
                        </div>
                        <Edit className={`h-4 w-4 transition-transform ${expandedSections.agents ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.agents ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-4 max-h-[50vh] overflow-y-auto">
                          <AgentsEditor
                            agents={(selectedConfig.content.agent as Record<string, any>) || {}}
                            onChange={(agents) => {
                              const updatedContent = {
                                ...selectedConfig.content,
                                agent: agents
                              }
                              updateConfigContent(selectedConfig.name, updatedContent)
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-card border border-border rounded-lg overflow-hidden">
                      <button
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedSections(prev => ({ ...prev, mcp: !prev.mcp }))}
                      >
                        <div className="flex items-center gap-3">
                          <h4 className="text-sm font-medium">MCP Servers</h4>
                          <span className="text-xs text-muted-foreground">
                            {Object.keys((selectedConfig.content.mcp as Record<string, any>) || {}).length} configured
                          </span>
                        </div>
                        <Edit className={`h-4 w-4 transition-transform ${expandedSections.mcp ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.mcp ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-4 max-h-[50vh] overflow-y-auto">
                          <McpManager
                            config={selectedConfig}
                            onUpdate={(content) => updateConfigContent(selectedConfig.name, content)}
                            onConfigUpdate={updateConfigContent}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="bg-card border border-border rounded-lg p-6">
                    <p className="text-muted-foreground text-center">Select a configuration to edit its commands, agents, and MCP servers.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteDialog
        open={!!deleteConfirmConfig}
        onOpenChange={() => setDeleteConfirmConfig(null)}
        onConfirm={() => deleteConfirmConfig && deleteConfig(deleteConfirmConfig)}
        onCancel={() => setDeleteConfirmConfig(null)}
        title="Delete Configuration"
        description="Any repositories using this configuration will continue to work but won't receive updates."
        itemName={deleteConfirmConfig?.name}
        isDeleting={isUpdating}
      />
    </div>
  )
}
