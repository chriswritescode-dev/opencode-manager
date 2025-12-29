import { useState, useEffect, useRef } from 'react'
import { Loader2, Plus, Trash2, Edit, Star, StarOff, Download, RotateCcw, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { CreateConfigDialog } from './CreateConfigDialog'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import { CommandsEditor } from './CommandsEditor'
import { AgentsEditor } from './AgentsEditor'
import { AgentsMdEditor } from './AgentsMdEditor'
import { McpManager } from './McpManager'
import { settingsApi } from '@/api/settings'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerHealth } from '@/hooks/useServerHealth'
import { parseJsonc, hasJsoncComments } from '@/lib/jsonc'
import { showToast } from '@/lib/toast'
import type { OpenCodeConfig } from '@/api/types/settings'

interface Command {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  topP?: number
}

interface Agent {
  prompt?: string
  description?: string
  mode?: 'subagent' | 'primary' | 'all'
  temperature?: number
  topP?: number
  top_p?: number
  model?: string
  tools?: Record<string, boolean>
  permission?: {
    edit?: 'ask' | 'allow' | 'deny'
    bash?: 'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
    webfetch?: 'ask' | 'allow' | 'deny'
  }
  disable?: boolean
  [key: string]: unknown
}

export function OpenCodeConfigManager() {
  const queryClient = useQueryClient()
  const { data: health } = useServerHealth()
  const [configs, setConfigs] = useState<OpenCodeConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editingConfig, setEditingConfig] = useState<OpenCodeConfig | null>(null)
  const [selectedConfig, setSelectedConfig] = useState<OpenCodeConfig | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    agentsMd: false,
    commands: false,
    agents: false,
    mcp: false,
  })
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [deleteConfirmConfig, setDeleteConfirmConfig] = useState<OpenCodeConfig | null>(null)
  
  const agentsMdRef = useRef<HTMLButtonElement>(null)
  const commandsRef = useRef<HTMLButtonElement>(null)
  const agentsRef = useRef<HTMLButtonElement>(null)
  const mcpRef = useRef<HTMLButtonElement>(null)
  
  const scrollToSection = (ref: React.RefObject<HTMLButtonElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start',
        inline: 'nearest'
      })
    }
  }

  const restartServerMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.restartOpenCodeServer()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
      showToast.success('Server restarted successfully', { id: 'update-restart' })
    },
    onError: (error: unknown) => {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
           || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
           || 'Failed to restart OpenCode server')
        : 'Failed to restart OpenCode server'
      showToast.error(errorMessage, { id: 'update-restart' })
    },
  })

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.rollbackOpenCodeConfig()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      showToast.success(data.message, { id: 'rollback-config' })
      fetchConfigs()
    },
    onError: () => {
      showToast.error('Failed to rollback to previous config', { id: 'rollback-config' })
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

  const updateConfigContent = async (configName: string, newContent: Record<string, unknown>, restartServer = false) => {
    try {
      setIsUpdating(true)
      const previousContent = configs.find(c => c.name === configName)?.content

      await settingsApi.updateOpenCodeConfig(configName, { content: newContent })

      setConfigs(prev => prev.map(config =>
        config.name === configName
          ? { ...config, content: newContent, updatedAt: Date.now() }
          : config
      ))

      if (selectedConfig && selectedConfig.name === configName) {
        setSelectedConfig({ ...selectedConfig, content: newContent, updatedAt: Date.now() })
      }

      const agentsChanged = JSON.stringify(previousContent?.agent) !== JSON.stringify(newContent.agent)
      if (restartServer || agentsChanged) {
        showToast.loading('Restarting server...', { id: 'update-restart' })
        await restartServerMutation.mutateAsync()
      } else {
        showToast.success('Configuration updated')
      }

      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
    } catch (error) {
      console.error('Failed to update config:', error)
      showToast.error('Failed to update config')
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

  const createConfig = async (name: string, rawContent: string, isDefault: boolean) => {
    showToast.loading('Creating configuration...', { id: 'create-config' })
    try {
      setIsUpdating(true)
      const parsedContent = parseJsonc<Record<string, unknown>>(rawContent)

      const forbiddenFields = ['id', 'createdAt', 'updatedAt']
      const foundForbidden = forbiddenFields.filter(field => field in parsedContent)
      if (foundForbidden.length > 0) {
        throw new Error(`Invalid fields found: ${foundForbidden.join(', ')}. These fields are managed automatically.`)
      }

      await settingsApi.createOpenCodeConfig({
        name: name.trim(),
        content: rawContent,
        isDefault,
      })

      setIsCreateDialogOpen(false)
      await fetchConfigs()

      if (isDefault) {
        showToast.loading('Restarting server...', { id: 'create-config' })
        await restartServerMutation.mutateAsync()
      } else {
        showToast.success('Configuration created')
      }

      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
    } catch (error) {
      console.error('Failed to create config:', error)
      showToast.error('Failed to create configuration', { id: 'create-config' })
      throw error
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
      // Invalidate agents cache in case deleted config had agents
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
    } catch (error) {
      console.error('Failed to delete config:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const setDefaultConfig = async (config: OpenCodeConfig) => {
    showToast.loading('Setting default config and restarting server...', { id: 'set-default' })
    try {
      setIsUpdating(true)
      await settingsApi.setDefaultOpenCodeConfig(config.name)
      await fetchConfigs()
      await restartServerMutation.mutateAsync()
      showToast.success('Default config updated and server restarted', { id: 'set-default' })
    } catch (error) {
      console.error('Failed to set default config:', error)
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
           || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
           || 'Failed to set default config')
        : 'Failed to set default config'
      showToast.error(errorMessage, { id: 'set-default' })
    } finally {
      setIsUpdating(false)
    }
  }

  

  const downloadConfig = (config: OpenCodeConfig) => {
    const content = config.rawContent || JSON.stringify(config.content, null, 2)
    const extension = config.rawContent && hasJsoncComments(config.rawContent) ? 'jsonc' : 'json'
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.name}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
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

  const isUnhealthy = health?.opencode !== 'healthy'

  return (
    <div className="space-y-6 overflow-y-auto">
      {health && (
        <Card className={isUnhealthy ? 'border-destructive' : ''}>
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center items-center gap-3">
              <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
                <div className={`h-3 w-3 rounded-full ${isUnhealthy ? 'bg-destructive animate-pulse' : 'bg-green-500'}`} />
                <p className="font-medium text-sm sm:text-base">
                  Server Status: {isUnhealthy ? 'Unhealthy' : 'Healthy'}
                </p>
                {health.error && (
                  <p className="text-xs text-destructive">
                    {health.error}
                  </p>
                )}
                {health.opencodeVersion && (
                  <p className="text-xs text-muted-foreground">
                    v{health.opencodeVersion}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    showToast.loading('Restarting OpenCode server...', { id: 'manual-restart' })
                    restartServerMutation.mutate()
                  }}
                  disabled={restartServerMutation.isPending}
                >
                  {restartServerMutation.isPending ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  )}
                  <span className="text-xs sm:text-sm">Restart</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    showToast.loading('Rolling back to previous config...', { id: 'rollback-config' })
                    rollbackMutation.mutate()
                  }}
                  disabled={rollbackMutation.isPending}
                >
                  {rollbackMutation.isPending ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  )}
                  <span className="text-xs sm:text-sm">Rollback</span>
                </Button>
                <Button 
                  size="sm"
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  <span className="text-xs sm:text-sm">New Config</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <CreateConfigDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreate={createConfig}
        isUpdating={isUpdating}
      />

      {configs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No OpenCode configurations found. Create your first config to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{config.name}</CardTitle>
                    {config.isDefault && (
                      <Badge variant="default" className="">
                        <Star className="h-4 w-4" />
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
                <div className="text-sm text-muted-foreground break-words">
                  <p className="truncate">Updated: {new Date(config.updatedAt).toLocaleString()}</p>
                  <p className="truncate">Created: {new Date(config.createdAt).toLocaleString()}</p>
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
        onUpdate={async (rawContent) => {
          if (!editingConfig) return
          showToast.loading('Saving configuration...', { id: 'edit-config' })
          try {
            const parsedContent = parseJsonc<Record<string, unknown>>(rawContent)
            const agentsChanged = JSON.stringify(editingConfig.content.agent) !== JSON.stringify(parsedContent.agent)
            await settingsApi.updateOpenCodeConfig(editingConfig.name, { content: rawContent })
            await fetchConfigs()
            if (agentsChanged) {
              showToast.loading('Restarting server...', { id: 'restart-server' })
              await restartServerMutation.mutateAsync()
              showToast.success('Config updated and server restarted', { id: 'restart-server' })
            } else {
              showToast.success('Configuration saved', { id: 'edit-config' })
            }
            queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
          } catch {
            showToast.error('Failed to save configuration', { id: 'edit-config' })
          }
        }}
        isUpdating={isUpdating}
      />

      {/* Global AGENTS.md Section */}
      <div className="mt-8 space-y-6">
        <div className="border-t border-border pt-6">
          <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0 mb-6">
            <button
              ref={agentsMdRef}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors min-w-0"
              onClick={() => {
                const isExpanding = !expandedSections.agentsMd
                setExpandedSections(prev => ({ ...prev, agentsMd: isExpanding }))
                if (isExpanding) {
                  setTimeout(() => scrollToSection(agentsMdRef), 100)
                }
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 text-blue-500" />
                <h4 className="text-sm font-medium truncate">Global Agent Instructions (AGENTS.md)</h4>
              </div>
              <Edit className={`h-4 w-4 transition-transform ${expandedSections.agentsMd ? 'rotate-90' : ''}`} />
            </button>
            <div className={`${expandedSections.agentsMd ? 'block' : 'hidden'} border-t border-border`}>
              <div className="p-4">
                <AgentsMdEditor />
              </div>
            </div>
          </div>

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
              
              <div className="flex flex-col gap-4 pb-20 min-w-0">
                {selectedConfig ? (
                  <>
                    <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
                      <button
                        ref={commandsRef}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors min-w-0"
                        onClick={() => {
                          const isExpanding = !expandedSections.commands
                          setExpandedSections(prev => ({ ...prev, commands: isExpanding }))
                          
                          if (isExpanding) {
                            setTimeout(() => scrollToSection(commandsRef), 100)
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <h4 className="text-sm font-medium truncate">Commands</h4>
                          <span className="text-xs text-muted-foreground">
                            {Object.keys(selectedConfig.content.command as Record<string, Command> || {}).length} configured
                          </span>
                        </div>
                        <Edit className={`h-4 w-4 transition-transform ${expandedSections.commands ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.commands ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-1 sm:p-4 max-h-[50vh] overflow-y-auto">
                          <CommandsEditor
                            commands={(selectedConfig.content.command as Record<string, Command>) || {}}
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
                    
                    <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
                      <button
                        ref={agentsRef}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors min-w-0"
                        onClick={() => {
                          const isExpanding = !expandedSections.agents
                          setExpandedSections(prev => ({ ...prev, agents: isExpanding }))
                          
                          if (isExpanding) {
                            setTimeout(() => scrollToSection(agentsRef), 100)
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <h4 className="text-sm font-medium truncate">Agents</h4>
                          <span className="text-xs text-muted-foreground">
                            {Object.keys(selectedConfig.content.agent as Record<string, Agent> || {}).length} configured
                          </span>
                        </div>
                        <Edit className={`h-4 w-4 transition-transform ${expandedSections.agents ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.agents ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-4 max-h-[50vh] overflow-y-auto">
                          <AgentsEditor
                            agents={(selectedConfig.content.agent as Record<string, Agent>) || {}}
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

                    <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
                      <button
                        ref={mcpRef}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors min-w-0"
                        onClick={() => {
                          const isExpanding = !expandedSections.mcp
                          setExpandedSections(prev => ({ ...prev, mcp: isExpanding }))
                          
                          if (isExpanding) {
                            setTimeout(() => scrollToSection(mcpRef), 100)
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <h4 className="text-sm font-medium truncate">MCP Servers</h4>
                          <span className="text-xs text-muted-foreground">
                            {Object.keys((selectedConfig.content.mcp as Record<string, unknown>) || {}).length} configured
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
