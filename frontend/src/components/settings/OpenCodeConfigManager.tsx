import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Loader2, Plus, Trash2, Edit, Download, RotateCcw, FileText, ArrowUpCircle, History, ChevronDown, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { RestartServerDialog } from './RestartServerDialog'
import { CreateConfigDialog } from './CreateConfigDialog'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import { CommandsEditor } from './CommandsEditor'
import { AgentsEditor } from './AgentsEditor'
import { AgentsMdEditor } from './AgentsMdEditor'
import { McpManager } from './McpManager'
import { SkillsEditor } from './SkillsEditor'
import { OpenCodeModelsEditor, type ConfigProvider } from './OpenCodeModelsEditor'
import { VersionSelectDialog } from './VersionSelectDialog'
import { settingsApi } from '@/api/settings'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useOpenCodeServerActions } from '@/hooks/useOpenCodeServerActions'
import { parseJsonc, hasJsoncComments } from '@/lib/jsonc'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
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

interface OpenCodeConfigManagerProps {
  hideHealthStatus?: boolean
}

const EXPANDED_SECTION_CONTENT_CLASS = 'p-2 sm:p-4'

export function OpenCodeConfigManager({ hideHealthStatus = false }: OpenCodeConfigManagerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: health } = useServerHealth()
  const [configs, setConfigs] = useState<OpenCodeConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editingConfig, setEditingConfig] = useState<OpenCodeConfig | null>(null)
  const [selectedConfig, setSelectedConfig] = useState<OpenCodeConfig | null>(null)
  const [activeConfigName, setActiveConfigName] = useState<string>('')
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
  const {
    restartServerMutation,
    upgradeOpenCodeMutation,
    confirmOpen: isRestartPromptOpen,
    setConfirmOpen: setIsRestartPromptOpen,
    activeSessionCount,
    requestRestart,
    confirmRestart,
    performUpgrade,
  } = useOpenCodeServerActions()
  
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

  const { data: directoryCommands = [] } = useQuery({
    queryKey: ['opencode-directory-files', 'commands'],
    queryFn: () => settingsApi.listOpenCodeDirectoryFiles('commands'),
    staleTime: 30 * 1000,
  })

  const { data: directoryAgents = [] } = useQuery({
    queryKey: ['opencode-directory-files', 'agents'],
    queryFn: () => settingsApi.listOpenCodeDirectoryFiles('agents'),
    staleTime: 30 * 1000,
  })

  const scrollToSection = (ref: React.RefObject<HTMLButtonElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest',
        inline: 'nearest'
      })
    }
  }

  const syncOpenCodeImportMutation = useMutation({
    mutationFn: async () => settingsApi.syncOpenCodeImport(),
    onSuccess: async () => {
      await fetchConfigs()
      invalidateConfigCaches(queryClient)
      queryClient.invalidateQueries({ queryKey: ['opencode-import-status'] })
    },
  })

  const getApiErrorMessage = getOpenCodeApiErrorMessage

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

  const updateConfigContent = async (configName: string, newContent: Record<string, unknown>) => {
    const previousConfig = configs.find(c => c.name === configName)
    const previousContent = previousConfig?.content
    const previousSelectedConfig = selectedConfig
    const now = Date.now()

    setConfigs(prev => prev.map(config =>
      config.name === configName ? { ...config, content: newContent, updatedAt: now } : config
    ))
    if (selectedConfig && selectedConfig.name === configName) {
      setSelectedConfig({ ...selectedConfig, content: newContent, updatedAt: now })
    }

    try {
      setIsUpdating(true)
      const result = await settingsApi.updateOpenCodeConfig(configName, { content: newContent })
      if (result.removedFields && result.removedFields.length > 0) {
        showToast.info(`Configuration updated after removing invalid fields: ${result.removedFields.join(', ')}`)
      } else if (result.restartRequired) {
        showToast.success('Configuration saved. Restart the server to apply changes.')
      } else {
        showToast.success('Configuration updated')
      }
      invalidateConfigCaches(queryClient)
    } catch (error) {
      setConfigs(prev => prev.map(config =>
        config.name === configName ? { ...config, content: previousContent ?? {}, updatedAt: previousConfig?.updatedAt ?? now } : config
      ))
      if (previousSelectedConfig && previousSelectedConfig.name === configName) {
        setSelectedConfig(previousSelectedConfig)
      }
      console.error('Failed to update config:', error)
      showToast.error(getApiErrorMessage(error, 'Failed to update config'))
    } finally {
      setIsUpdating(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  useEffect(() => {
    if (configs.length === 0) {
      setActiveConfigName('')
      return
    }
    const stillExists = configs.some((c) => c.name === activeConfigName)
    if (!stillExists) {
      const fallback = configs.find((c) => c.isDefault) ?? configs[0]
      setActiveConfigName(fallback.name)
    }
  }, [configs, activeConfigName])

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
      if (result.removedFields && result.removedFields.length > 0) {
        showToast.info(`Default config updated after removing invalid fields: ${result.removedFields.join(', ')}`, { id: 'set-default' })
      } else {
        showToast.success('Default config updated and applied', { id: 'set-default' })
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
  const activeConfig = configs.find((c) => c.name === activeConfigName) ?? null

  return (
    <div className="space-y-6 min-w-0">
      {!hideHealthStatus && health && (
        <Card className={cn('bg-transparent border-transparent', isUnhealthy && 'border-destructive')}>
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center items-center justify-center gap-3">
              <div className="flex items-center gap-2 flex-wrap justify-center ">
                <div className={`h-3 w-3 rounded-full ${isUnhealthy ? 'bg-destructive animate-pulse' : 'bg-green-500'}`} />
                <p className="font-medium text-sm sm:text-base">
                  {t('opencodeConfig.serverStatus')} {isUnhealthy ? t('opencodeConfig.unhealthy') : t('opencodeConfig.healthy')}
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
                  onClick={performUpgrade}
                  disabled={upgradeOpenCodeMutation.isPending}
                >
                  {upgradeOpenCodeMutation.isPending ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  )}
                  <span className="text-xs sm:text-sm">{t('common.update')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={requestRestart}
                  disabled={restartServerMutation.isPending}
                >
                  {restartServerMutation.isPending ? (
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  )}
                  <span className="text-xs sm:text-sm">{t('opencodeConfig.restart')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsVersionDialogOpen(true)}
                >
                  <History className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                  <span className="text-xs sm:text-sm">{t('opencodeConfig.versions')}</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
       )}

       {health?.opencodeRestartPending && (
         <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
           <div className="flex items-center gap-2">
             <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
             <p className="text-sm">
               {t('opencodeConfig.restartDesc')}
             </p>
           </div>
           <Button
             size="sm"
             onClick={requestRestart}
             disabled={restartServerMutation.isPending}
             className="shrink-0"
           >
             {restartServerMutation.isPending ? (
               <Loader2 className="h-3 w-3 mr-1 animate-spin" />
             ) : (
               <RotateCcw className="h-3 w-3 mr-1" />
             )}
             {t('opencodeConfig.restartNow')}
           </Button>
         </div>
       )}

       <Card>
         <CardHeader className="pb-3">
           <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                      <CardTitle className="text-sm sm:text-base">{t('opencodeConfig.existingHostImport')}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('opencodeConfig.hostImportDesc')}
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
                <span className="text-xs sm:text-sm">{t('opencodeConfig.importFromHost')}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">{t('opencodeConfig.configSource')}</p>
                <p className="mt-1 break-all text-muted-foreground">
                  {isImportStatusLoading ? t('opencodeConfig.checking') : importStatus?.configSourcePath || t('opencodeConfig.noImportableConfig')}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">{t('opencodeConfig.stateSource')}</p>
                <p className="mt-1 break-all text-muted-foreground">
                  {isImportStatusLoading ? t('opencodeConfig.checking') : importStatus?.stateSourcePath || t('opencodeConfig.noImportableState')}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">{t('opencodeConfig.workspaceState')}</p>
              <p className="mt-1 break-all text-muted-foreground">
                {importStatus?.workspaceStatePath || t('opencodeConfig.unavailable')}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {importStatus?.workspaceStateExists
                  ? t('opencodeConfig.workspaceStateExists')
                  : t('opencodeConfig.noWorkspaceState')}
              </p>
            </div>
            {syncOpenCodeImportMutation.error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="font-medium text-destructive">{t('opencodeConfig.importBlocked')}</p>
                <p className="mt-1 text-sm text-destructive/90">
                  {getOpenCodeImportErrorMessage(syncOpenCodeImportMutation.error)}
                </p>
                <p className="mt-2 text-xs text-destructive/80">
                  {t('opencodeConfig.importBlockedDesc')}
                </p>
              </div>
            )}
            {syncOpenCodeImportMutation.data?.relinkedRepos && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">{t('opencodeConfig.lastRelinkResult')}</p>
                <p className="mt-1 text-muted-foreground">
                  Linked {syncOpenCodeImportMutation.data.relinkedRepos.relinkedCount} repos, matched {syncOpenCodeImportMutation.data.relinkedRepos.existingCount} existing repos, skipped {syncOpenCodeImportMutation.data.relinkedRepos.nonRepoPathCount} non-repo session paths, and ignored {syncOpenCodeImportMutation.data.relinkedRepos.duplicatePathCount} duplicate session paths.
                </p>
                {syncOpenCodeImportMutation.data.relinkedRepos.errors.length > 0 && (
                  <p className="mt-2 text-xs text-destructive">
                    {t('opencodeConfig.couldNotLink', { count: syncOpenCodeImportMutation.data.relinkedRepos.errors.length })}
                  </p>
                )}
              </div>
            )}
            {!canImportFromHost && !isImportStatusLoading && (
              <p className="text-xs text-muted-foreground">
                {t('opencodeConfig.noHostDetected')}
              </p>
            )}
          </CardContent>
        </Card>

        
        
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
            <p className="text-muted-foreground">{t('opencodeConfig.noConfigsFound')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">{t('opencodeConfig.configurations')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={activeConfigName}
                onValueChange={(value) => {
                  setActiveConfigName(value)
                }}
              >
                <SelectTrigger className="w-full sm:max-w-xs">
                  <SelectValue placeholder="Select a configuration...">
                    {activeConfig && (
                      <>
                        {activeConfig.name}
                        {activeConfig.isDefault && (
                          <span className="text-orange-500 dark:text-orange-400">{t('opencodeConfig.active')}</span>
                        )}
                        {!activeConfig.isValid && t('opencodeConfig.invalid')}
                      </>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {configs.map((config) => (
                    <SelectItem key={config.id} value={config.name}>
                      {config.name}
                      {config.isDefault && (
                        <span className="text-orange-500 dark:text-orange-400">{t('opencodeConfig.active')}</span>
                      )}
                      {!config.isValid && t('opencodeConfig.invalid')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                {activeConfig && !activeConfig.isValid && (
                  <Badge variant="destructive">{t('opencodeConfig.invalidConfig')}</Badge>
                )}
              </div>

              <TooltipProvider delayDuration={200}>
                <div className="flex items-center gap-1 sm:gap-1.5 sm:ml-auto">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!activeConfig}
                        onClick={() => activeConfig && downloadConfig(activeConfig)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('settings.download')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!activeConfig}
                        onClick={() => activeConfig && startEdit(activeConfig)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('common.edit')}</TooltipContent>
                  </Tooltip>
                  {!activeConfig?.isDefault && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="default"
                          disabled={!activeConfig || isUpdating}
                          onClick={() => activeConfig && setDefaultConfig(activeConfig)}
                        >
                          Apply
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{t('opencodeConfig.applyAsDefault')}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!activeConfig}
                        className="text-red-500 hover:text-red-600"
                        onClick={() => activeConfig && setDeleteConfirmConfig(activeConfig)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('common.delete')}</TooltipContent>
                  </Tooltip>
                  <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                    <span className="text-xs sm:text-sm">{t('opencodeConfig.newConfig')}</span>
                  </Button>
                </div>
              </TooltipProvider>
            </div>

            {activeConfig && (
              <div className="text-sm text-muted-foreground break-words">
                <p className="truncate">{t('opencodeConfig.updated')}: {new Date(activeConfig.updatedAt).toLocaleString()}</p>
                <p className="truncate">{t('opencodeConfig.created')}: {new Date(activeConfig.createdAt).toLocaleString()}</p>
              </div>
            )}
          </CardContent>
        </Card>
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
            const result = await settingsApi.updateOpenCodeConfig(editingConfig.name, { content: rawContent })
            await fetchConfigs()
            const successMsg = result.restartRequired
              ? 'Configuration saved. Restart the server to apply changes.'
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
                <h4 className="text-sm font-medium truncate">{t('opencodeConfig.globalAgentInstructions')}</h4>
              </div>
              <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.agentsMd ? 'rotate-90' : ''}`} />
            </button>
            <div className={`${expandedSections.agentsMd ? 'block' : 'hidden'} border-t border-border`}>
              <div className="p-4">
                <AgentsMdEditor />
              </div>
            </div>
          </div>

          <h3 className="text-base sm:text-lg font-semibold mb-4">{t('opencodeConfig.configureCmdsAgentsMcp')}</h3>
          <p className="text-sm text-muted-foreground mb-6">
            {t('opencodeConfig.configureCmdsAgentsMcpDesc')}
          </p>
          
          {configs.length > 0 && (
            <div className="space-y-6">
              <div className='px-1'>
                <Label className="text-sm sm:text-base font-medium">{t('opencodeConfig.selectConfigToEdit')}</Label>
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
                        {config.name} {config.isDefault &&t('opencodeConfig.default')} {!config.isValid && '(Invalid)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex flex-col gap-4 pb-4 min-w-0">
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
                            {Object.keys((selectedConfig.content?.command as Record<string, Command> | undefined) ?? {}).length + directoryCommands.length} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.commands ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.commands ? 'block' : 'hidden'} border-t border-border`}>
                        <div className={EXPANDED_SECTION_CONTENT_CLASS}>
                          <CommandsEditor
                            commands={(selectedConfig.content?.command as Record<string, Command> | undefined) ?? {}}
                            directoryCommands={directoryCommands}
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
                            {Object.keys((selectedConfig.content?.agent as Record<string, Agent> | undefined) ?? {}).length + directoryAgents.length} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.agents ? 'rotate-90' : ''}`} />
                      </button>
                      <div className={`${expandedSections.agents ? 'block' : 'hidden'} border-t border-border`}>
                        <div className={EXPANDED_SECTION_CONTENT_CLASS}>
                          <AgentsEditor
                            agents={(selectedConfig.content?.agent as Record<string, Agent> | undefined) ?? {}}
                            directoryAgents={directoryAgents}
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
                            {managedSkills.length} configured
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.skills ? 'rotate-90' : ''}`} />
                      </button>
                        <div className={`${expandedSections.skills ? 'block' : 'hidden'} border-t border-border`}>
                          <div className={EXPANDED_SECTION_CONTENT_CLASS}>
                            <SkillsEditor
                              managedSkills={managedSkills}
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
                        <div className={EXPANDED_SECTION_CONTENT_CLASS}>
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
                        <div className={EXPANDED_SECTION_CONTENT_CLASS}>
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

      <RestartServerDialog
        open={isRestartPromptOpen}
        onOpenChange={setIsRestartPromptOpen}
        activeSessionCount={activeSessionCount}
        isRestarting={restartServerMutation.isPending}
        onCancel={() => setIsRestartPromptOpen(false)}
        onConfirm={confirmRestart}
      />
    </div>
  )
}
