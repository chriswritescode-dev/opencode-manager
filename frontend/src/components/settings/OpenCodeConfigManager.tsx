import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Loader2, Plus, Trash2, Edit, StarOff, Download, RotateCcw, FileText, ArrowUpCircle, History, ChevronDown } from 'lucide-react'
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
import { SkillsEditor } from './SkillsEditor'
import { OpenCodeModelsEditor, type ConfigProvider } from './OpenCodeModelsEditor'
import { VersionSelectDialog } from './VersionSelectDialog'
import { MemoryPluginConfig } from './MemoryPluginConfig'
import { settingsApi } from '@/api/settings'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerHealth } from '@/hooks/useServerHealth'
import { parseJsonc, hasJsoncComments } from '@/lib/jsonc'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { FetchError } from '@/api/fetchWrapper'
import type { OpenCodeConfig, OpenCodeImportStatus } from '@/api/types/settings'

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
    skills: false,
    mcp: false,
    models: false,
  })
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false)
  const [deleteConfirmConfig, setDeleteConfirmConfig] = useState<OpenCodeConfig | null>(null)
  
  const agentsMdRef = useRef<HTMLButtonElement>(null)
  const commandsRef = useRef<HTMLButtonElement>(null)
  const agentsRef = useRef<HTMLButtonElement>(null)
  const skillsRef = useRef<HTMLButtonElement>(null)
  const mcpRef = useRef<HTMLButtonElement>(null)
  const modelsRef = useRef<HTMLButtonElement>(null)
  
  const { data: managedSkills = [] } = useQuery({
    queryKey: ['managed-skills'],
    queryFn: () => settingsApi.listManagedSkills(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: importStatus, isLoading: isImportStatusLoading } = useQuery<OpenCodeImportStatus>({
    queryKey: ['opencode-import-status'],
    queryFn: () => settingsApi.getOpenCodeImportStatus(),
    staleTime: 30 * 1000,
  })

  const scrollToSection = (ref: React.RefObject<HTMLButtonElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start',
        inline: 'nearest'
      })
    }
  }

  const reloadConfigMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.reloadOpenCodeConfig()
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
    },
  })

  const restartServerMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.restartOpenCodeServer()
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
    },
  })

  const upgradeOpenCodeMutation = useMutation({
    mutationFn: async () => {
      return await settingsApi.upgradeOpenCode()
    },
    onSuccess: (data) => {
      if (data.upgraded && data.newVersion) {
        queryClient.setQueryData(['health'], (old: Record<string, unknown> | undefined) => {
          if (!old) return old
          return { ...old, opencodeVersion: data.newVersion }
        })
      }
      invalidateConfigCaches(queryClient)
      if (data.upgraded) {
        showToast.success(`Upgraded to v${data.newVersion} and server restarted`, { id: 'upgrade-opencode' })
      } else {
        showToast.success('OpenCode is already up to date', { id: 'upgrade-opencode' })
      }
    },
    onError: (error) => {
      const defaultMessage = 'Failed to upgrade OpenCode'
      
      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { data?: { recovered?: boolean; recoveryMessage?: string; newVersion?: string } } }).response
        const data = response?.data
        
        if (data?.recovered && data.newVersion) {
          queryClient.setQueryData(['health'], (old: Record<string, unknown> | undefined) => {
            if (!old) return old
            return { ...old, opencodeVersion: data.newVersion }
          })
          showToast.success(`Upgrade failed but server recovered at v${data.newVersion}`, { id: 'upgrade-opencode' })
        } else {
          showToast.error(data?.recoveryMessage || defaultMessage, { id: 'upgrade-opencode' })
        }
      } else {
        showToast.error(defaultMessage, { id: 'upgrade-opencode' })
      }
      invalidateConfigCaches(queryClient)
    },
  })

  const syncOpenCodeImportMutation = useMutation({
    mutationFn: async () => settingsApi.syncOpenCodeImport(),
    onSuccess: async () => {
      await fetchConfigs()
      invalidateConfigCaches(queryClient)
      queryClient.invalidateQueries({ queryKey: ['opencode-import-status'] })
    },
  })

  const getApiErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof FetchError) {
      let message = error.detail || error.message || fallback

      if (error.validationIssues && error.validationIssues.length > 0) {
        const issues = error.validationIssues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')
        message = `Validation failed: ${issues}`
      }

      if (error.removedFields && error.removedFields.length > 0) {
        message += ` (removed invalid fields: ${error.removedFields.join(', ')})`
      }

      return message
    }

    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { data?: { details?: string; error?: string; validationIssues?: Array<{ path: string; message: string }>; removedFields?: string[] } } }).response
      const data = response?.data
      
      let message = data?.details || data?.error || fallback
      
      if (data?.validationIssues && data.validationIssues.length > 0) {
        const issues = data.validationIssues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')
        message = `Validation failed: ${issues}`
      }
      
      if (data?.removedFields && data.removedFields.length > 0) {
        const removed = data.removedFields.join(', ')
        message += ` (removed invalid fields: ${removed})`
      }
      
      return message
    }
    return fallback
  }

  const getRestartErrorMessage = (error: unknown): string => {
    return getApiErrorMessage(error, 'Failed to restart OpenCode server')
  }

  const getOpenCodeImportErrorMessage = (error: unknown): string => {
    if (error instanceof FetchError && error.code === 'OPENCODE_IMPORT_PROTECTED') {
      return error.detail || error.message
    }

    return getApiErrorMessage(error, 'Failed to import existing OpenCode host data')
  }

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

      const result = await settingsApi.updateOpenCodeConfig(configName, { content: newContent })

      setConfigs(prev => prev.map(config =>
        config.name === configName
          ? { ...config, content: newContent, updatedAt: Date.now() }
          : config
      ))

      if (selectedConfig && selectedConfig.name === configName) {
        setSelectedConfig({ ...selectedConfig, content: newContent, updatedAt: Date.now() })
      }

      const agentsChanged = JSON.stringify(previousContent?.agent) !== JSON.stringify(newContent.agent)
      const pluginsChanged = JSON.stringify(previousContent?.plugin) !== JSON.stringify(newContent.plugin)
      const skillsChanged = JSON.stringify(previousContent?.skills) !== JSON.stringify(newContent.skills)
      const providersChanged = JSON.stringify(previousContent?.provider) !== JSON.stringify(newContent.provider)
      if (restartServer || agentsChanged || pluginsChanged || skillsChanged || providersChanged) {
        showToast.loading('Reloading server...', { id: 'update-restart' })
        try {
          await reloadConfigMutation.mutateAsync()
          if (result.removedFields && result.removedFields.length > 0) {
            showToast.info(`Configuration updated after removing invalid fields: ${result.removedFields.join(', ')}`, { id: 'update-restart' })
          } else {
            showToast.success('Configuration updated and server reloaded', { id: 'update-restart' })
          }
        } catch (error) {
          showToast.error(getRestartErrorMessage(error), { id: 'update-restart' })
          throw error
        }
      } else {
        if (result.removedFields && result.removedFields.length > 0) {
          showToast.info(`Configuration applied after removing invalid fields: ${result.removedFields.join(', ')}`, { id: 'update-restart' })
        } else {
          showToast.success('Configuration updated')
        }
        invalidateConfigCaches(queryClient)
      }
    } catch (error) {
      console.error('Failed to update config:', error)
      showToast.error(getApiErrorMessage(error, 'Failed to update config'), { id: 'update-restart' })
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

      const result = await settingsApi.createOpenCodeConfig({
        name: name.trim(),
        content: rawContent,
        isDefault,
      })

      setIsCreateDialogOpen(false)
      await fetchConfigs()

      if (isDefault) {
        if (result.removedFields && result.removedFields.length > 0) {
          showToast.info(`Configuration created after removing invalid fields: ${result.removedFields.join(', ')}`, { id: 'create-config' })
        } else {
          showToast.success('Configuration created and applied', { id: 'create-config' })
        }
      } else {
        showToast.success('Configuration created', { id: 'create-config' })
      }

      invalidateConfigCaches(queryClient)
    } catch (error) {
      console.error('Failed to create config:', error)
      showToast.error(getApiErrorMessage(error, 'Failed to create configuration'), { id: 'create-config' })
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
      if (selectedConfig?.id === config.id) {
        setSelectedConfig(null)
      }
      fetchConfigs()
      invalidateConfigCaches(queryClient)
    } catch (error) {
      console.error('Failed to delete config:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const setDefaultConfig = async (config: OpenCodeConfig) => {
    showToast.loading('Setting default config...', { id: 'set-default' })
    try {
      setIsUpdating(true)
      const result = await settingsApi.setDefaultOpenCodeConfig(config.name)
      await fetchConfigs()
      invalidateConfigCaches(queryClient)

      if (result.reloadError) {
        showToast.error(`Default set but server reload failed: ${result.reloadError}`, { id: 'set-default' })
        return
      }

      const removedSuffix = result.removedFields && result.removedFields.length > 0
        ? ` (removed invalid fields: ${result.removedFields.join(', ')})`
        : ''

      if (result.restarted) {
        showToast.success(`Default config updated and server restarted${removedSuffix}`, { id: 'set-default' })
      } else if (result.reloaded) {
        showToast.success(`Default config updated and server reloaded${removedSuffix}`, { id: 'set-default' })
      } else {
        showToast.success(`Default config updated${removedSuffix}`, { id: 'set-default' })
      }
    } catch (error) {
      console.error('Failed to set default config:', error)
      showToast.error(getApiErrorMessage(error, 'Failed to set default config'), { id: 'set-default' })
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
  const canImportFromHost = Boolean(importStatus?.configSourcePath || importStatus?.stateSourcePath)

  return (
    <div className="space-y-6 overflow-y-auto">
      {health && (
        <Card className={cn('bg-transparent border-transparent', isUnhealthy && 'border-destructive')}>
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center items-center justify-center gap-3">
              <div className="flex items-center gap-2 flex-wrap justify-center ">
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
                    OpenCode v{health.opencodeVersion}
                  </p>
                )}
                {health.opencodeManagerVersion && (
                  <p className="text-xs text-muted-foreground">
                    Manager v{health.opencodeManagerVersion}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    showToast.loading('Upgrading OpenCode...', { id: 'upgrade-opencode' })
                    try {
                      await upgradeOpenCodeMutation.mutateAsync()
                    } catch (error) {
                      const errorMessage = error && typeof error === 'object' && 'response' in error
                        ? ((error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.details
                           || (error as { response?: { data?: { details?: string; error?: string } } }).response?.data?.error
                           || 'Failed to upgrade OpenCode')
                        : 'Failed to upgrade OpenCode'
                      showToast.error(errorMessage, { id: 'upgrade-opencode' })
                    }
                  }}
                  disabled={upgradeOpenCodeMutation.isPending}
                >
                  {upgradeOpenCodeMutation.isPending ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  )}
                  <span className="text-xs sm:text-sm">Update</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    showToast.loading('Restarting OpenCode server...', { id: 'manual-restart' })
                    try {
                      await restartServerMutation.mutateAsync()
                      showToast.success('Server restarted successfully', { id: 'manual-restart' })
                    } catch (error) {
                      showToast.error(getRestartErrorMessage(error), { id: 'manual-restart' })
                    }
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
                  onClick={() => setIsVersionDialogOpen(true)}
                >
                  <History className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  <span className="text-xs sm:text-sm">Versions</span>
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

       <Card>
         <CardHeader className="pb-3">
           <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                      <CardTitle className="text-sm sm:text-base">Existing OpenCode Host Import</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Import your standalone OpenCode config and session state into this workspace, then restart the server so existing chats can reconnect.
                </p>
              </div>
             <Button
               variant="outline"
               size="sm"
               disabled={!canImportFromHost || syncOpenCodeImportMutation.isPending || isImportStatusLoading}
                onClick={async () => {
                  showToast.loading('Importing existing OpenCode host data...', { id: 'opencode-import' })
                  try {
                    const result = await syncOpenCodeImportMutation.mutateAsync()
                    const importedParts = [result.configImported && 'config', result.stateImported && 'state']
                      .filter(Boolean)
                      .join(' and ')
                    const relinkSummary = result.relinkedRepos
                      ? ` Linked ${result.relinkedRepos.relinkedCount} repos, matched ${result.relinkedRepos.existingCount} existing repos, skipped ${result.relinkedRepos.nonRepoPathCount} non-repo paths, and ignored ${result.relinkedRepos.duplicatePathCount} duplicate session paths.`
                      : ''
                    showToast.success(`Imported existing OpenCode ${importedParts || 'data'} and restarted the server.${relinkSummary}`, { id: 'opencode-import' })
                  } catch (error) {
                    showToast.error(getOpenCodeImportErrorMessage(error), { id: 'opencode-import' })
                  }
                }}
              >
                {syncOpenCodeImportMutation.isPending ? (
                  <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                )}
                <span className="text-xs sm:text-sm">Import From Host</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">Config Source</p>
                <p className="mt-1 break-all text-muted-foreground">
                  {isImportStatusLoading ? 'Checking...' : importStatus?.configSourcePath || 'No importable OpenCode config found'}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">State Source</p>
                <p className="mt-1 break-all text-muted-foreground">
                  {isImportStatusLoading ? 'Checking...' : importStatus?.stateSourcePath || 'No importable OpenCode state found'}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">Workspace State</p>
              <p className="mt-1 break-all text-muted-foreground">
                {importStatus?.workspaceStatePath || 'Unavailable'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {importStatus?.workspaceStateExists
                  ? 'A workspace session database already exists. Import is blocked to protect it from being replaced by detected host state.'
                  : 'No workspace session database exists yet. Import will seed it from the detected host state.'}
              </p>
            </div>
            {syncOpenCodeImportMutation.error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="font-medium text-destructive">Import blocked</p>
                <p className="mt-1 text-sm text-destructive/90">
                  {getOpenCodeImportErrorMessage(syncOpenCodeImportMutation.error)}
                </p>
                <p className="mt-2 text-xs text-destructive/80">
                  This workspace already has OpenCode session state, so host state import was stopped to prevent accidental replacement of existing chats and history. If you want to use host state instead, clear the workspace state first and then run the import again.
                </p>
              </div>
            )}
            {syncOpenCodeImportMutation.data?.relinkedRepos && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">Last Relink Result</p>
                <p className="mt-1 text-muted-foreground">
                  Linked {syncOpenCodeImportMutation.data.relinkedRepos.relinkedCount} repos, matched {syncOpenCodeImportMutation.data.relinkedRepos.existingCount} existing repos, skipped {syncOpenCodeImportMutation.data.relinkedRepos.nonRepoPathCount} non-repo session paths, and ignored {syncOpenCodeImportMutation.data.relinkedRepos.duplicatePathCount} duplicate session paths.
                </p>
                {syncOpenCodeImportMutation.data.relinkedRepos.errors.length > 0 && (
                  <p className="mt-2 text-xs text-destructive">
                    {syncOpenCodeImportMutation.data.relinkedRepos.errors.length} repo paths could not be linked.
                  </p>
                )}
              </div>
            )}
            {!canImportFromHost && !isImportStatusLoading && (
              <p className="text-xs text-muted-foreground">
                No host OpenCode config or state was detected. For Docker installs, bind your host OpenCode config and state into the container before using this action.
              </p>
            )}
          </CardContent>
        </Card>

        <MemoryPluginConfig 
           memoryPluginEnabled={((configs.find(c => c.isDefault)?.content?.plugin as string[] | undefined) ?? []).includes('@opencode-manager/memory')}
           onToggle={async (enabled) => {
              const defaultConfig = configs.find(c => c.isDefault)
              if (!defaultConfig) return
              
              const currentPlugins = (defaultConfig.content?.plugin as string[] | undefined) ?? []
             const memoryPlugin = '@opencode-manager/memory'
             const newPlugins = enabled
               ? currentPlugins.includes(memoryPlugin)
                 ? currentPlugins
                 : [...currentPlugins, memoryPlugin]
               : currentPlugins.filter(p => p !== memoryPlugin)
             
             await updateConfigContent(defaultConfig.name, {
               ...defaultConfig.content,
               plugin: newPlugins.length > 0 ? newPlugins : undefined
             }, true)
             
             queryClient.invalidateQueries({ queryKey: ['memory-plugin-status'] })
           }}
         />
        
        <CreateConfigDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreate={createConfig}
        isUpdating={isUpdating}
      />

      <VersionSelectDialog
        open={isVersionDialogOpen}
        onOpenChange={setIsVersionDialogOpen}
      />

      {configs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No OpenCode configurations found. Create your first config to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols">
          {configs
            .sort((a, b) => {
              if (a.isDefault) return -1
              if (b.isDefault) return 1
              return 0
            })
            .map((config) => (
              <Card key={config.id} className={cn('border-transparent', config.isDefault && 'border-green-500')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-sm sm:text-base">{config.name}</CardTitle>
                      {!config.isValid && (
                        <Badge variant="destructive">
                          Invalid Config
                        </Badge>
                      )}
                      {config.isDefault && (
                        <Badge variant="default" className="text-green-500 bg-green-500/10">
                          Current
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
                        <StarOff className="h-4 w-4" />
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
            await settingsApi.updateOpenCodeConfig(editingConfig.name, { content: rawContent })
            await fetchConfigs()
            const successMsg = editingConfig.isDefault
              ? 'Configuration saved and server reloaded'
              : 'Configuration saved'
            showToast.success(successMsg, { id: 'edit-config' })
            invalidateConfigCaches(queryClient)
          } catch (error) {
            showToast.error(getApiErrorMessage(error, 'Failed to save configuration'), { id: 'edit-config' })
            throw error
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
              className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.agentsMd ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
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
              <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.agentsMd ? 'rotate-90' : ''}`} />
            </button>
            <div className={`${expandedSections.agentsMd ? 'block' : 'hidden'} border-t border-border`}>
              <div className="p-4">
                <AgentsMdEditor />
              </div>
            </div>
          </div>

          <h3 className="text-base sm:text-lg font-semibold mb-4">Configure Commands, Agents & MCP Servers</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Add custom commands, agents, and MCP servers to your OpenCode configurations. Select a configuration below to edit its settings.
          </p>
          
          {configs.length > 0 && (
            <div className="space-y-6">
              <div className='px-1'>
                <Label className="text-sm sm:text-base font-medium">Select Configuration to Edit</Label>
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
                        {config.name} {config.isDefault && '(Default)'} {!config.isValid && '(Invalid)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex flex-col gap-4 pb-20 min-w-0">
                {selectedConfig ? (
                  <>
                    {!selectedConfig.isValid && selectedConfig.validationIssues && selectedConfig.validationIssues.length > 0 && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                        <p className="font-medium text-destructive">This configuration has validation issues</p>
                        <p className="mt-1 text-sm text-destructive/90">
                          OpenCode may fail to start until these fields are corrected. Open the config editor to fix the file directly.
                        </p>
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive/90">
                          {selectedConfig.validationIssues.slice(0, 8).map((issue) => (
                            <li key={`${issue.path}-${issue.message}`}>
                              <span className="font-mono text-xs">{issue.path}</span>: {issue.message}
                            </li>
                          ))}
                        </ul>
                        {selectedConfig.validationIssues.length > 8 && (
                          <p className="mt-2 text-xs text-destructive/80">
                            Showing 8 of {selectedConfig.validationIssues.length} issues. Open the config editor to review and fix the file.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
                      <button
                        ref={commandsRef}
                        className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.commands ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
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
                            {Object.keys((selectedConfig.content?.command as Record<string, Command> | undefined) ?? {}).length} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.commands ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.commands ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-1 sm:p-4 max-h-[50vh] overflow-y-auto">
                          <CommandsEditor
                            commands={(selectedConfig.content?.command as Record<string, Command> | undefined) ?? {}}
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
                        className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.agents ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
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
                            {Object.keys((selectedConfig.content?.agent as Record<string, Agent> | undefined) ?? {}).length} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.agents ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.agents ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-4 max-h-[50vh] overflow-y-auto">
                          <AgentsEditor
                            agents={(selectedConfig.content?.agent as Record<string, Agent> | undefined) ?? {}}
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
                        ref={skillsRef}
                        className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.skills ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
                        onClick={() => {
                          const isExpanding = !expandedSections.skills
                          setExpandedSections(prev => ({ ...prev, skills: isExpanding }))
                          if (isExpanding) {
                            setTimeout(() => scrollToSection(skillsRef), 100)
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <h4 className="text-sm font-medium truncate">Skills</h4>
                          <span className="text-xs text-muted-foreground">
                            {managedSkills.length + (((selectedConfig.content?.skills as { paths?: string[]; urls?: string[] } | undefined)?.paths?.length) ?? 0) + (((selectedConfig.content?.skills as { paths?: string[]; urls?: string[] } | undefined)?.urls?.length) ?? 0)} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.skills ? 'rotate-90' : ''}`} />
                      </button>
                        <div className={`${expandedSections.skills ? 'block' : 'hidden'} border-t border-border`}>
                          <div className="p-4 max-h-[50vh] overflow-y-auto">
                            <SkillsEditor
                              skills={selectedConfig.content?.skills as { paths?: string[]; urls?: string[] } | undefined}
                              managedSkills={managedSkills}
                              onChange={(skills) => {
                                const paths = skills?.paths?.filter(Boolean)
                                const urls = skills?.urls?.filter(Boolean)
                                const updatedContent = {
                                  ...selectedConfig.content,
                                  skills: (paths?.length || urls?.length) ? { paths: paths?.length ? paths : undefined, urls: urls?.length ? urls : undefined } : undefined
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
                        className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.mcp ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
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
                            {Object.keys((selectedConfig.content?.mcp as Record<string, unknown> | undefined) ?? {}).length} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.mcp ? 'rotate-90' : ''}`} />
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

                    <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
                      <button
                        ref={modelsRef}
                        className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.models ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
                        onClick={() => {
                          const isExpanding = !expandedSections.models
                          setExpandedSections(prev => ({ ...prev, models: isExpanding }))
                          
                          if (isExpanding) {
                            setTimeout(() => scrollToSection(modelsRef), 100)
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <h4 className="text-sm font-medium truncate">Models</h4>
                          <span className="text-xs text-muted-foreground">
                            {(() => {
                              const provider = selectedConfig.content?.provider as Record<string, unknown> | undefined
                              if (!provider) return 0
                              return Object.values(provider).reduce<number>((acc, p) => {
                                const models = (p as { models?: Record<string, unknown> })?.models
                                return acc + (models ? Object.keys(models).length : 0)
                              }, 0)
                            })()} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.models ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.models ? 'block' : 'hidden'} border-t border-border`}>
                        <div className="p-4 max-h-[50vh] overflow-y-auto">
                          <OpenCodeModelsEditor
                            providers={(selectedConfig.content?.provider as Record<string, ConfigProvider> | undefined) ?? {}}
                            onChange={(providers) => {
                              const updatedContent = {
                                ...selectedConfig.content,
                                provider: providers
                              }
                              updateConfigContent(selectedConfig.name, updatedContent)
                            }}
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
