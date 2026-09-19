import { useState, useRef, useId } from 'react'
import { cn } from '@/lib/utils'
import { Loader2, Edit, Download, RotateCcw, FileText, ChevronDown, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RestartServerDialog } from './RestartServerDialog'
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
import { useOpenCodeConfigFile, OPEN_CODE_CONFIG_QUERY_KEY } from '@/hooks/useOpenCodeConfigFile'
import { hasJsoncComments } from '@/lib/jsonc'
import { showToast } from '@/lib/toast'
import { saveFile } from '@/lib/download'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import { FetchError } from '@/api/fetchWrapper'
import type { OpenCodeConfigFile, OpenCodeImportStatus } from '@/api/types/settings'

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

const EXPANDED_SECTION_CONTENT_CLASS = 'p-2 sm:p-4'

export function OpenCodeConfigManager() {
  const hostImportContentId = useId()
  const queryClient = useQueryClient()
  const { data: health } = useServerHealth()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    agentsMd: false,
    commands: false,
    agents: false,
    skills: false,
    mcp: false,
    models: false,
    hostImport: false,
  })
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false)
  const {
    restartServerMutation,
    confirmOpen: isRestartPromptOpen,
    setConfirmOpen: setIsRestartPromptOpen,
    activeSessionCount,
    requestRestart,
    confirmRestart,
  } = useOpenCodeServerActions()
  
  const agentsMdRef = useRef<HTMLButtonElement>(null)
  const commandsRef = useRef<HTMLButtonElement>(null)
  const agentsRef = useRef<HTMLButtonElement>(null)
  const skillsRef = useRef<HTMLButtonElement>(null)
  const mcpRef = useRef<HTMLButtonElement>(null)
  const modelsRef = useRef<HTMLButtonElement>(null)
  
  const { data: config, isLoading } = useOpenCodeConfigFile()

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
    onSuccess: () => {
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

  const updateConfigContent = async (newContent: Record<string, unknown>) => {
    const previousConfig = queryClient.getQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY)
    const now = Date.now()

    queryClient.setQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY, (prev) =>
      prev ? { ...prev, content: newContent, updatedAt: now } : prev
    )

    try {
      const result = await settingsApi.updateOpenCodeConfig({ content: newContent })
      if (result.removedFields && result.removedFields.length > 0) {
        showToast.info(`Configuration updated after removing invalid fields: ${result.removedFields.join(', ')}`)
      } else if (result.restartRequired) {
        showToast.success('Configuration saved. Restart the server to apply changes.')
      } else {
        showToast.success('Configuration updated')
      }
      invalidateConfigCaches(queryClient)
    } catch (error) {
      if (previousConfig) {
        queryClient.setQueryData(OPEN_CODE_CONFIG_QUERY_KEY, previousConfig)
      }
      showToast.error(getApiErrorMessage(error, 'Failed to update config'))
    }
  }

  const downloadConfig = (config: OpenCodeConfigFile) => {
    const content = config.rawContent || JSON.stringify(config.content, null, 2)
    const extension = config.rawContent && hasJsoncComments(config.rawContent) ? 'jsonc' : 'json'
    const blob = new Blob([content], { type: 'application/json' })
    void saveFile(blob, `opencode.${extension}`)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const canImportFromHost = Boolean(importStatus?.configSourcePath || importStatus?.stateSourcePath)

  return (
    <div className="space-y-6 min-w-0">
       {health?.opencodeRestartPending && (
         <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
           <div className="flex items-center gap-2">
             <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
             <p className="text-sm">
               Configuration changes are saved but require a server restart to take effect.
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
             Restart Now
           </Button>
         </div>
       )}

      <VersionSelectDialog
        open={isVersionDialogOpen}
        onOpenChange={setIsVersionDialogOpen}
      />

      {!config ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No OpenCode configuration file found. Restart the Manager to seed one.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base">OpenCode Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{config.path}</p>
                  <p className="truncate text-sm text-muted-foreground">Updated: {new Date(config.updatedAt).toLocaleString()}</p>
                </div>

                {!config.isValid && (
                  <Badge variant="destructive">Invalid Config</Badge>
                )}

                <TooltipProvider delayDuration={200}>
                  <div className="flex items-center gap-1 sm:gap-1.5 sm:ml-auto">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadConfig(config)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Download</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsEditDialogOpen(true)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Edit</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>

              {!config.isValid && config.validationIssues && config.validationIssues.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                  <p className="font-medium text-destructive">This configuration has validation issues</p>
                  <p className="mt-1 text-sm text-destructive/90">
                    OpenCode may fail to start until these fields are corrected. Open the config editor to fix the file directly.
                  </p>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive/90">
                    {config.validationIssues.slice(0, 8).map((issue) => (
                      <li key={`${issue.path}-${issue.message}`}>
                        <span className="font-mono text-xs">{issue.path}</span>: {issue.message}
                      </li>
                    ))}
                  </ul>
                  {config.validationIssues.length > 8 && (
                    <p className="mt-2 text-xs text-destructive/80">
                      Showing 8 of {config.validationIssues.length} issues. Open the config editor to review and fix the file.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <OpenCodeConfigEditor
            config={config}
            isOpen={isEditDialogOpen}
            onClose={() => setIsEditDialogOpen(false)}
            onUpdate={async (rawContent) => {
              await settingsApi.updateOpenCodeConfig({ content: rawContent })
              await queryClient.invalidateQueries({ queryKey: OPEN_CODE_CONFIG_QUERY_KEY })
            }}
          />
        </>
      )}

          <div className="mt-8 space-y-6">
            <div className="border-t border-border pt-6">
              <div className="bg-card border border-border rounded-lg overflow-clip min-w-0 mb-6">
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
                Add custom commands, agents, and MCP servers to your OpenCode configuration.
              </p>
              
              {config && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 pb-4 min-w-0">
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
                          {Object.keys((config.content.command as Record<string, Command> | undefined) ?? {}).length + directoryCommands.length} configured
                        </span>
                      </div>
                      <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.commands ? 'rotate-90' : ''}`} />
                    </button>
                    <div className={`${expandedSections.commands ? 'block' : 'hidden'} border-t border-border`}>
                      <div className={EXPANDED_SECTION_CONTENT_CLASS}>
                        <CommandsEditor
                          commands={(config.content.command as Record<string, Command> | undefined) ?? {}}
                          directoryCommands={directoryCommands}
                          onChange={(commands) => {
                            updateConfigContent({
                              ...config.content,
                              command: commands
                            })
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
                          {Object.keys((config.content.agent as Record<string, Agent> | undefined) ?? {}).length + directoryAgents.length} configured
                        </span>
                      </div>
                      <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.agents ? 'rotate-90' : ''}`} />
                    </button>
                    <div className={`${expandedSections.agents ? 'block' : 'hidden'} border-t border-border`}>
                      <div className={EXPANDED_SECTION_CONTENT_CLASS}>
                        <AgentsEditor
                          agents={(config.content.agent as Record<string, Agent> | undefined) ?? {}}
                          directoryAgents={directoryAgents}
                          onChange={(agents) => {
                            updateConfigContent({
                              ...config.content,
                              agent: agents
                            })
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
                          {Object.keys((config.content.mcp as Record<string, unknown> | undefined) ?? {}).length} configured
                        </span>
                      </div>
                      <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.mcp ? 'rotate-90' : ''}`} />
                    </button>
                    <div className={`${expandedSections.mcp ? 'block' : 'hidden'} border-t border-border`}>
                      <div className={EXPANDED_SECTION_CONTENT_CLASS}>
                        <McpManager
                          config={config}
                          onUpdate={updateConfigContent}
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
                            const provider = config.content.provider as Record<string, unknown> | undefined
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
                          providers={(config.content.provider as Record<string, ConfigProvider> | undefined) ?? {}}
                          onChange={(providers) => {
                            updateConfigContent({
                              ...config.content,
                              provider: providers
                            })
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
        <button
          className={cn("w-full px-4 py-3 flex items-center justify-between transition-colors min-w-0", expandedSections.hostImport ? "bg-muted/40 hover:bg-muted/50" : "hover:bg-muted/50")}
          aria-expanded={expandedSections.hostImport}
          aria-controls={hostImportContentId}
          onClick={() => setExpandedSections(prev => ({ ...prev, hostImport: !prev.hostImport }))}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Download className="h-4 w-4 text-blue-500" />
            <h4 className="text-sm font-medium truncate">Existing OpenCode Host Import</h4>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${expandedSections.hostImport ? 'rotate-90' : ''}`} />
        </button>
        <div id={hostImportContentId} className={`${expandedSections.hostImport ? 'block' : 'hidden'} border-t border-border`}>
          <div className={cn(EXPANDED_SECTION_CONTENT_CLASS, 'space-y-3 text-sm')}>
            <p className="text-muted-foreground">
              Import your standalone OpenCode config and session state into this workspace, then restart the server so existing chats can reconnect.
            </p>
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
          </div>
        </div>
      </div>

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
