import { useState, useRef, useId } from 'react'
import { cn } from '@/lib/utils'
import { Loader2, Edit, Download, RotateCcw, FileText, ChevronDown, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RestartServerDialog } from './RestartServerDialog'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import { OpenCodeConfigSourcesNotice } from './OpenCodeConfigSourcesNotice'
import { CommandsEditor } from './CommandsEditor'
import { AgentsEditor } from './AgentsEditor'
import { AgentsMdEditor } from './AgentsMdEditor'
import { McpManager } from './McpManager'
import { SkillsEditor } from './SkillsEditor'
import { OpenCodeModelsEditor, type ConfigProvider } from './OpenCodeModelsEditor'
import { scrollSectionIntoView } from '@/lib/settingsScroll'
import { VersionSelectDialog } from './VersionSelectDialog'
import { settingsApi } from '@/api/settings'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useOpenCodeServerActions } from '@/hooks/useOpenCodeServerActions'
import { useOpenCodeConfigFile, OPEN_CODE_CONFIG_QUERY_KEY } from '@/hooks/useOpenCodeConfigFile'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import { mcpServersFromConfig } from '@opencode-manager/shared/opencode'
import { FetchError } from '@/api/fetchWrapper'
import { getPreferredOpenCodeConfigSource, downloadOpenCodeConfigSource } from '@/api/types/settings'
import type { OpenCodeConfigFile, OpenCodeConfigSaveResponse, OpenCodeImportStatus } from '@/api/types/settings'

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

type ConfigSectionKey = 'agentsMd' | 'commands' | 'agents' | 'skills' | 'mcp' | 'models' | 'hostImport'

const SECTION_LIST_CLASS = 'divide-y divide-border/60 border-t border-border/60'
const SECTION_HEADER_CLASS = 'flex w-full min-w-0 items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'
const SECTION_CONTENT_CLASS = 'pb-4'
const SECTION_CHEVRON_CLASS = 'h-4 w-4 shrink-0 transition-transform'
const SECTION_TITLE_CLASS = 'text-sm font-medium truncate'
const SECTION_META_CLASS = 'text-xs text-muted-foreground'

const getConfigFileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export function OpenCodeConfigManager() {
  const sectionIdPrefix = useId()
  const agentsMdContentId = `${sectionIdPrefix}-agents-md`
  const commandsContentId = `${sectionIdPrefix}-commands`
  const agentsContentId = `${sectionIdPrefix}-agents`
  const skillsContentId = `${sectionIdPrefix}-skills`
  const mcpContentId = `${sectionIdPrefix}-mcp`
  const modelsContentId = `${sectionIdPrefix}-models`
  const hostImportContentId = `${sectionIdPrefix}-host-import`

  const queryClient = useQueryClient()
  const { data: health } = useServerHealth()
  const [expandedSections, setExpandedSections] = useState<Record<ConfigSectionKey, boolean>>({
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
  const hostImportRef = useRef<HTMLButtonElement>(null)
  
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

  const toggleSection = (section: ConfigSectionKey, ref?: React.RefObject<HTMLButtonElement | null>) => {
    const isExpanding = !expandedSections[section]
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
    if (isExpanding) {
      setTimeout(() => scrollSectionIntoView(ref?.current ?? null), 0)
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

  const applyOpenCodeConfigSave = (result: OpenCodeConfigSaveResponse) => {
    queryClient.setQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY, result)
    if (result.restartRequired) {
      showToast.success('Configuration saved. Restart the server to apply changes.')
    } else {
      showToast.success('Configuration updated')
    }
    invalidateConfigCaches(queryClient, { skipOpenCodeConfig: true })
  }

  const updateConfigContent = async (newContent: Record<string, unknown>) => {
    const expectedRevision = queryClient.getQueryData<OpenCodeConfigFile>(
      OPEN_CODE_CONFIG_QUERY_KEY,
    )?.revision
    const result = await settingsApi.updateOpenCodeConfig({
      content: newContent,
      expectedRevision,
    })
    applyOpenCodeConfigSave(result)
  }

  const updateConfigContentSafely = (newContent: Record<string, unknown>) => {
    void updateConfigContent(newContent).catch((error) => {
      showToast.error(getApiErrorMessage(error, 'Failed to update config'))
    })
  }

  const downloadConfig = (config: OpenCodeConfigFile) => {
    const preferredSource = getPreferredOpenCodeConfigSource(config)
    if (preferredSource) {
      downloadOpenCodeConfigSource(preferredSource)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const canImportFromHost = Boolean(importStatus?.configSourcePath || importStatus?.stateSourcePath)
  const workspaceConfigPathsToRemove = importStatus?.workspaceConfigPathsToRemove ?? []
  const hostConfigSourcePaths = importStatus?.configSourcePaths ?? []

  return (
    <div className="min-w-0 space-y-4">
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
        <p className="py-8 text-center text-sm text-muted-foreground">
          No OpenCode configuration file found. Restart the Manager to seed one.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{getConfigFileName(config.path)}</p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">File location and updated time</summary>
                  <p className="mt-1 break-all">{config.path}</p>
                  <p className="mt-1">Updated: {new Date(config.updatedAt).toLocaleString()}</p>
                </details>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!config.isValid && (
                <Badge variant="destructive">Invalid Config</Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => setIsEditDialogOpen(true)}
              >
                <Edit className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => downloadConfig(config)}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                Download
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Merged persisted settings. Saves write to the preferred config file; removing a value deletes its override so an inherited value can reappear. Restart the server to apply changes.
          </p>

          <OpenCodeConfigSourcesNotice config={config} />

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

          <OpenCodeConfigEditor
            config={config}
            isOpen={isEditDialogOpen}
            onClose={() => setIsEditDialogOpen(false)}
            onUpdate={async ({ content, source, expectedRevision }) => {
              const result = await settingsApi.updateOpenCodeConfig({
                content,
                source,
                expectedRevision,
              })
              applyOpenCodeConfigSave(result)
            }}
          />
        </>
      )}

      <div className={cn('mt-6', SECTION_LIST_CLASS)}>
        <div>
          <button
            ref={agentsMdRef}
            type="button"
            aria-expanded={expandedSections.agentsMd}
            aria-controls={agentsMdContentId}
            className={cn(SECTION_HEADER_CLASS, 'flex-wrap sm:flex-nowrap')}
            onClick={() => toggleSection('agentsMd', agentsMdRef)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-4 w-4 shrink-0 text-blue-500" />
              <div className="min-w-0 text-left">
                <h4 className="text-sm font-medium">Global Agent Instructions (AGENTS.md)</h4>
                <p className={SECTION_META_CLASS}>Applies across OpenCode</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs font-medium text-blue-500">Edit AGENTS.md</span>
              <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.agentsMd && 'rotate-180')} />
            </div>
          </button>
          <div
            id={agentsMdContentId}
            className={cn(SECTION_CONTENT_CLASS, expandedSections.agentsMd ? 'block' : 'hidden')}
          >
            <AgentsMdEditor />
          </div>
        </div>

        {config && (
          <>
            <div>
              <button
                ref={commandsRef}
                type="button"
                aria-expanded={expandedSections.commands}
                aria-controls={commandsContentId}
                className={SECTION_HEADER_CLASS}
                onClick={() => toggleSection('commands', commandsRef)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <h4 className={SECTION_TITLE_CLASS}>Commands</h4>
                  <span className={SECTION_META_CLASS}>
                    {Object.keys((config.content.command as Record<string, Command> | undefined) ?? {}).length + directoryCommands.length} configured
                  </span>
                </div>
                <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.commands && 'rotate-180')} />
              </button>
              <div
                id={commandsContentId}
                className={cn(SECTION_CONTENT_CLASS, expandedSections.commands ? 'block' : 'hidden')}
              >
                <CommandsEditor
                  commands={(config.content.command as Record<string, Command> | undefined) ?? {}}
                  directoryCommands={directoryCommands}
                  onChange={(commands) => {
                    updateConfigContentSafely({
                      ...config.content,
                      command: commands
                    })
                  }}
                />
              </div>
            </div>

            <div>
              <button
                ref={agentsRef}
                type="button"
                aria-expanded={expandedSections.agents}
                aria-controls={agentsContentId}
                className={SECTION_HEADER_CLASS}
                onClick={() => toggleSection('agents', agentsRef)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <h4 className={SECTION_TITLE_CLASS}>Agents</h4>
                  <span className={SECTION_META_CLASS}>
                    {Object.keys((config.content.agent as Record<string, Agent> | undefined) ?? {}).length + directoryAgents.length} configured
                  </span>
                </div>
                <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.agents && 'rotate-180')} />
              </button>
              <div
                id={agentsContentId}
                className={cn(SECTION_CONTENT_CLASS, expandedSections.agents ? 'block' : 'hidden')}
              >
                <AgentsEditor
                  agents={(config.content.agent as Record<string, Agent> | undefined) ?? {}}
                  directoryAgents={directoryAgents}
                  onChange={(agents) => {
                    updateConfigContentSafely({
                      ...config.content,
                      agent: agents
                    })
                  }}
                />
              </div>
            </div>

            <div>
              <button
                ref={skillsRef}
                type="button"
                aria-expanded={expandedSections.skills}
                aria-controls={skillsContentId}
                className={SECTION_HEADER_CLASS}
                onClick={() => toggleSection('skills', skillsRef)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <h4 className={SECTION_TITLE_CLASS}>Skills</h4>
                  <span className={SECTION_META_CLASS}>
                    {managedSkills.length} configured
                  </span>
                </div>
                <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.skills && 'rotate-180')} />
              </button>
              <div
                id={skillsContentId}
                className={cn(SECTION_CONTENT_CLASS, expandedSections.skills ? 'block' : 'hidden')}
              >
                <SkillsEditor
                  managedSkills={managedSkills}
                />
              </div>
            </div>

            <div>
              <button
                ref={mcpRef}
                type="button"
                aria-expanded={expandedSections.mcp}
                aria-controls={mcpContentId}
                className={SECTION_HEADER_CLASS}
                onClick={() => toggleSection('mcp', mcpRef)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <h4 className={SECTION_TITLE_CLASS}>MCP Servers</h4>
                  <span className={SECTION_META_CLASS}>
                    {Object.keys(mcpServersFromConfig(config.content.mcp)).length} configured
                  </span>
                </div>
                <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.mcp && 'rotate-180')} />
              </button>
              <div
                id={mcpContentId}
                className={cn(SECTION_CONTENT_CLASS, expandedSections.mcp ? 'block' : 'hidden')}
              >
                <McpManager
                  config={config}
                  onUpdate={updateConfigContent}
                />
              </div>
            </div>

            <div>
              <button
                ref={modelsRef}
                type="button"
                aria-expanded={expandedSections.models}
                aria-controls={modelsContentId}
                className={SECTION_HEADER_CLASS}
                onClick={() => toggleSection('models', modelsRef)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <h4 className={SECTION_TITLE_CLASS}>Models</h4>
                  <span className={SECTION_META_CLASS}>
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
                <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.models && 'rotate-180')} />
              </button>
              <div
                id={modelsContentId}
                className={cn(SECTION_CONTENT_CLASS, expandedSections.models ? 'block' : 'hidden')}
              >
                <OpenCodeModelsEditor
                  providers={(config.content.provider as Record<string, ConfigProvider> | undefined) ?? {}}
                  onChange={(providers) => {
                    updateConfigContentSafely({
                      ...config.content,
                      provider: providers
                    })
                  }}
                />
              </div>
            </div>
          </>
        )}

        <div>
          <button
            ref={hostImportRef}
            type="button"
            aria-expanded={expandedSections.hostImport}
            aria-controls={hostImportContentId}
            className={SECTION_HEADER_CLASS}
            onClick={() => toggleSection('hostImport', hostImportRef)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Download className="h-4 w-4 shrink-0 text-blue-500" />
              <h4 className={SECTION_TITLE_CLASS}>Existing OpenCode Host Import</h4>
            </div>
            <ChevronDown className={cn(SECTION_CHEVRON_CLASS, expandedSections.hostImport && 'rotate-180')} />
          </button>
          <div
            id={hostImportContentId}
            className={cn(SECTION_CONTENT_CLASS, 'space-y-3 text-sm', expandedSections.hostImport ? 'block' : 'hidden')}
          >
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
            {!isImportStatusLoading && workspaceConfigPathsToRemove.length > 0 && (
              <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Importing replaces the workspace configuration files. These files will be removed:{' '}
                  {workspaceConfigPathsToRemove.map(getConfigFileName).join(', ')}.
                  {hostConfigSourcePaths.length > 1 && (
                    <> Host files imported: {hostConfigSourcePaths.map(getConfigFileName).join(', ')}.</>
                  )}
                </span>
              </p>
            )}
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
