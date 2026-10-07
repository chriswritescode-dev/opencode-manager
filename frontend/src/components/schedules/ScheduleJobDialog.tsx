import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, PromptTemplate, ScheduleJob, ScheduleMcpServer, ScheduleWorkspaceMode } from '@opencode-manager/shared/types'
import { useScheduleModels } from '@/hooks/useScheduleModels'
import { resolveScheduleModel } from '@/lib/schedules/schedule-model'
import { useAgents } from '@/hooks/useOpenCode'
import { useScheduleTarget } from '@/hooks/useScheduleTarget'
import { settingsApi } from '@/api/settings'
import { mcpApi } from '@/api/mcp'
import { listRepos } from '@/api/repos'
import type { Repo } from '@/api/types'
import { Button } from '@/components/ui/button'
import type { ComboboxOption } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildCronExpressionFromPreset,
  detectSchedulePreset,
  getLocalTimeZone,
  type SchedulePreset,
} from '@/components/schedules/schedule-utils'
import { getRepoDisplayName } from '@/lib/utils'
import { getPrimaryAgents } from '@/lib/primaryAgents'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_NAME } from '@opencode-manager/shared/utils'
import { DEFAULT_DESTRUCTIVE_BASH_PATTERNS } from '@opencode-manager/shared/schemas'
import { Loader2 } from 'lucide-react'
import { usePromptTemplates, useDeletePromptTemplate } from '@/hooks/usePromptTemplates'
import { PromptTemplateDialog } from './PromptTemplateDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { GeneralTab } from './GeneralTab'
import { TimingTab } from './TimingTab'
import { PromptTab } from './PromptTab'
import { SkillsTab } from './SkillsTab'
import { McpTab } from './McpTab'

const EMPTY_TEMPLATES: PromptTemplate[] = []

type ScheduleJobDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  job?: ScheduleJob
  isSaving: boolean
  onSubmit: (data: CreateScheduleJobRequest) => void
  showRepoSelector?: boolean
  repoId?: number
  onRepoChange?: (repoId: number | undefined) => void
  isEditing?: boolean
}

export function ScheduleJobDialog({ open, onOpenChange, job, isSaving, onSubmit, showRepoSelector, repoId: selectedRepoId, onRepoChange }: ScheduleJobDialogProps) {
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('interval')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [timeOfDay, setTimeOfDay] = useState('09:00')
  const [hourlyMinute, setHourlyMinute] = useState('0')
  const [weeklyDays, setWeeklyDays] = useState<string[]>(['1'])
  const [monthlyDay, setMonthlyDay] = useState('1')
  const [cronExpression, setCronExpression] = useState('0 9 * * 1-5')
  const [timezone, setTimezone] = useState(getLocalTimeZone())
  const [agentSlug, setAgentSlug] = useState('')
  const [model, setModel] = useState('')
  const [modelDirty, setModelDirty] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<number | null>(null)
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [skillNotes, setSkillNotes] = useState('')
  const initialSkillSlugsRef = useRef<string[] | undefined>(undefined)
  const initialSkillNotesRef = useRef<string | undefined>(undefined)
  const [mcpServers, setMcpServers] = useState<ScheduleMcpServer[]>([])
  const [branch, setBranch] = useState('')
  const [workspaceMode, setWorkspaceMode] = useState<ScheduleWorkspaceMode>('worktree')
  const [allowExternalDirectory, setAllowExternalDirectory] = useState(false)
  const [allowQuestions, setAllowQuestions] = useState(false)
  const [bashDenyPatterns, setBashDenyPatterns] = useState<string[]>([...DEFAULT_DESTRUCTIVE_BASH_PATTERNS])
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | undefined>(undefined)
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null)

  const { data: templates = EMPTY_TEMPLATES } = usePromptTemplates()
  const deleteTemplateMutation = useDeletePromptTemplate()

  const effectiveRepoId = selectedRepoId ?? job?.repoId
  const { scheduleTarget } = useScheduleTarget(open ? effectiveRepoId : undefined)
  const scheduleDirectory = scheduleTarget?.fullPath

  const { availableModels } = useScheduleModels(open, scheduleDirectory)

  const resolvedModel = useMemo(
    () => (modelDirty ? (model.trim() || null) : resolveScheduleModel(model, availableModels)),
    [model, modelDirty, availableModels],
  )
  const { data: agents = [], isSuccess: agentsLoaded } = useAgents(scheduleDirectory, { enabled: !!scheduleDirectory })

  const { data: skills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ['managed-skills'],
    queryFn: () => settingsApi.listManagedSkills(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { data: mcpStatuses = {}, isLoading: mcpStatusesLoading } = useQuery({
    queryKey: ['mcp-status', scheduleDirectory],
    queryFn: () => mcpApi.getStatus(scheduleDirectory),
    enabled: open && !!scheduleDirectory,
  })

  const { data: repos = [] } = useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open && !!showRepoSelector,
    staleTime: 5 * 60 * 1000,
  })

  const repoOptions = useMemo<ComboboxOption[]>(() => {
    const assistantOption: ComboboxOption = {
      value: ASSISTANT_REPO_ID.toString(),
      label: ASSISTANT_REPO_NAME,
      description: 'Built-in assistant',
    }
    const repoEntries = repos
      .filter((repo) => repo.cloneStatus === 'ready')
      .map((repo) => ({
        value: repo.id.toString(),
        label: getRepoDisplayName(repo),
        description: repo.localPath,
      }))
    return [assistantOption, ...repoEntries]
  }, [repos])

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    return getPrimaryAgents(agents).map((agent) => ({
      value: agent.id,
      label: agent.name,
      description: agent.description,
    }))
  }, [agents])

  const selectedAgentSlug = agentsLoaded && !agentOptions.some((option) => option.value === agentSlug) ? '' : agentSlug

  useEffect(() => {
    if (!open) {
      return
    }

    setName(job?.name ?? '')
    setDescription(job?.description ?? '')
    setEnabled(job?.enabled ?? true)
    const scheduleDefaults = detectSchedulePreset(job)
    setSchedulePreset(scheduleDefaults.preset)
    setIntervalMinutes(scheduleDefaults.intervalMinutes)
    setTimeOfDay(scheduleDefaults.timeOfDay)
    setHourlyMinute(scheduleDefaults.hourlyMinute)
    setWeeklyDays(scheduleDefaults.weeklyDays)
    setMonthlyDay(scheduleDefaults.monthlyDay)
    setCronExpression(scheduleDefaults.cronExpression)
    setTimezone(scheduleDefaults.timezone)
    setAgentSlug(job?.agentSlug ?? '')
    setModel(job?.model ?? '')
    setModelDirty(false)
    setPrompt(job?.prompt ?? '')
    const initialSkillSlugs = job?.skillMetadata?.skillSlugs ?? []
    const initialSkillNotes = job?.skillMetadata?.notes ?? ''
    setSkillSlugs(initialSkillSlugs)
    setSkillNotes(initialSkillNotes)
    initialSkillSlugsRef.current = initialSkillSlugs
    initialSkillNotesRef.current = initialSkillNotes
    setMcpServers(job?.mcpServers ?? [])
    setBranch(job?.branch ?? '')
    setWorkspaceMode(job?.workspaceMode ?? 'worktree')
    setAllowExternalDirectory(job?.permissionConfig?.allowExternalDirectory ?? false)
    setAllowQuestions(job?.permissionConfig?.allowQuestions ?? false)
    setBashDenyPatterns(job?.permissionConfig?.bashDenyPatterns ?? [...DEFAULT_DESTRUCTIVE_BASH_PATTERNS])
  }, [job, open])

  useEffect(() => {
    if (!open) {
      return
    }
    const matchingTemplate = templates.find((template) => template.prompt === (job?.prompt ?? ''))
    setSelectedPromptTemplateId(matchingTemplate ? matchingTemplate.id : null)
  }, [templates, job, open])

  const applyPromptTemplate = (template: PromptTemplate) => {
    setSelectedPromptTemplateId(template.id)
    setName(template.suggestedName)
    setDescription(template.suggestedDescription)
    setPrompt(template.prompt)
  }

  const handleModelChange = (value: string) => {
    setModel(value)
    setModelDirty(true)
  }

  const handleSubmit = () => {
    const parsedInterval = Number.parseInt(intervalMinutes, 10)
    const resolvedCronExpression = buildCronExpressionFromPreset({
      preset: schedulePreset,
      intervalMinutes,
      timeOfDay,
      hourlyMinute,
      weeklyDays,
      monthlyDay,
      cronExpression,
    })
    const skillSlugsChanged = JSON.stringify(skillSlugs) !== JSON.stringify(initialSkillSlugsRef.current ?? [])
    const skillNotesChanged = skillNotes.trim() !== (initialSkillNotesRef.current ?? '')
    const shouldIncludeSkillMetadata = skillSlugsChanged || skillNotesChanged

    const baseFields = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      agentSlug: selectedAgentSlug.trim() || undefined,
      model: resolvedModel ?? undefined,
      prompt: prompt.trim(),
      branch: branch.trim() || null,
      workspaceMode,
      mcpServers,
      permissionConfig: {
        allowExternalDirectory,
        allowQuestions,
        bashDenyPatterns: bashDenyPatterns.map((p) => p.trim()).filter(Boolean),
      },
      ...(shouldIncludeSkillMetadata ? {
        skillMetadata: skillSlugs.length > 0 || skillNotes.trim()
          ? {
              skillSlugs,
              notes: skillNotes.trim() || undefined,
            }
          : null,
      } : {}),
    }

    if (schedulePreset !== 'interval') {
      onSubmit({
        ...baseFields,
        scheduleMode: 'cron',
        cronExpression: resolvedCronExpression,
        timezone: timezone.trim() || 'UTC',
      })
      return
    }

    onSubmit({
      ...baseFields,
      scheduleMode: 'interval',
      intervalMinutes: Number.isNaN(parsedInterval) ? 60 : parsedInterval,
    })
  }

  const isScheduleConfigInvalid =
    (schedulePreset === 'advanced' && (!cronExpression.trim() || !timezone.trim())) ||
    ((schedulePreset === 'daily' || schedulePreset === 'weekdays' || schedulePreset === 'weekly' || schedulePreset === 'monthly') && !timezone.trim()) ||
    (schedulePreset === 'weekly' && weeklyDays.length === 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-black/80"
        mobileFullscreen
        className="flex h-dvh max-h-dvh w-full max-w-4xl flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-lg sm:h-[min(85vh,760px)] sm:max-h-[85vh] sm:max-w-[90vw] sm:w-[calc(100vw-1rem)]"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-3 sm:px-6 py-4">
          <DialogTitle>{job ? 'Edit schedule' : 'New schedule'}</DialogTitle>
          <DialogDescription className="mt-0">
            Create a reusable repo job with a visual schedule builder, manual runs, and optional advanced metadata.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-3 sm:px-6 pb-3">
            <TabsList className="grid h-9 w-full grid-cols-5 bg-card p-0.5">
              <TabsTrigger value="basics" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">General</TabsTrigger>
              <TabsTrigger value="timing" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Timing</TabsTrigger>
              <TabsTrigger value="prompt" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Prompt</TabsTrigger>
              <TabsTrigger value="skills" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Skills</TabsTrigger>
              <TabsTrigger value="mcp" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">MCP</TabsTrigger>
            </TabsList>
          </div>

          <GeneralTab
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            agentSlug={selectedAgentSlug}
            onAgentSlugChange={setAgentSlug}
            agentOptions={agentOptions}
            model={resolvedModel ?? ''}
            onModelChange={handleModelChange}
            modelDirectory={scheduleDirectory}
            enabled={enabled}
            onEnabledChange={setEnabled}
            branch={branch}
            onBranchChange={setBranch}
            branchRepoId={open && effectiveRepoId !== ASSISTANT_REPO_ID ? effectiveRepoId : undefined}
            workspaceMode={workspaceMode}
            onWorkspaceModeChange={setWorkspaceMode}
            showWorkspaceMode={effectiveRepoId !== ASSISTANT_REPO_ID}
            showRepoSelector={showRepoSelector}
            isEditing={!!job}
            repoId={selectedRepoId}
            onRepoChange={onRepoChange}
            repoOptions={repoOptions}
            allowExternalDirectory={allowExternalDirectory}
            onAllowExternalDirectoryChange={setAllowExternalDirectory}
            allowQuestions={allowQuestions}
            onAllowQuestionsChange={setAllowQuestions}
            bashDenyPatterns={bashDenyPatterns}
            onBashDenyPatternsChange={setBashDenyPatterns}
          />

          <TimingTab
            schedulePreset={schedulePreset}
            onSchedulePresetChange={setSchedulePreset}
            intervalMinutes={intervalMinutes}
            onIntervalMinutesChange={setIntervalMinutes}
            timeOfDay={timeOfDay}
            onTimeOfDayChange={setTimeOfDay}
            hourlyMinute={hourlyMinute}
            onHourlyMinuteChange={setHourlyMinute}
            weeklyDays={weeklyDays}
            onWeeklyDaysChange={setWeeklyDays}
            monthlyDay={monthlyDay}
            onMonthlyDayChange={setMonthlyDay}
            cronExpression={cronExpression}
            onCronExpressionChange={setCronExpression}
            timezone={timezone}
            onTimezoneChange={setTimezone}
          />

          <PromptTab
            prompt={prompt}
            onPromptChange={setPrompt}
            selectedPromptTemplateId={selectedPromptTemplateId}
            onApplyTemplate={applyPromptTemplate}
            templates={templates}
            onEditTemplate={(template) => { setEditingTemplate(template); setTemplateDialogOpen(true) }}
            onDeleteTemplate={setDeletingTemplateId}
            onNewTemplate={() => { setEditingTemplate(undefined); setTemplateDialogOpen(true) }}
          />

          <SkillsTab
            skillSlugs={skillSlugs}
            onSkillSlugsChange={setSkillSlugs}
            skillNotes={skillNotes}
            onSkillNotesChange={setSkillNotes}
            skills={skills}
            skillsLoading={skillsLoading}
          />

          <McpTab
            mcpServers={mcpServers}
            onMcpServersChange={setMcpServers}
            availableServers={mcpStatuses}
            availableServersLoading={mcpStatusesLoading && !!scheduleDirectory}
          />
        </Tabs>

        <div className="mt-0 shrink-0 border-t border-border px-3 sm:px-6 py-4 flex flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !name.trim() || !prompt.trim() || isScheduleConfigInvalid || (!!showRepoSelector && !job && selectedRepoId === undefined)} className="flex-1 sm:flex-none">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? 'Saving...' : job ? 'Save changes' : 'Create schedule'}
          </Button>
        </div>
      </DialogContent>
      <PromptTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        template={editingTemplate}
      />
      <DeleteDialog
        open={deletingTemplateId !== null}
        onOpenChange={(open) => { if (!open && !deleteTemplateMutation.isPending) setDeletingTemplateId(null) }}
        onConfirm={() => {
          if (deletingTemplateId !== null) {
            deleteTemplateMutation.mutate(deletingTemplateId, {
              onSuccess: () => setDeletingTemplateId(null),
            })
          }
        }}
        onCancel={() => { if (!deleteTemplateMutation.isPending) setDeletingTemplateId(null) }}
        title="Delete template"
        description="Are you sure you want to delete this template?"
        isDeleting={deleteTemplateMutation.isPending}
      />
    </Dialog>
  )
}
