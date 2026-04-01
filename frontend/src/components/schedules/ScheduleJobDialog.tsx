import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, PromptTemplate, ScheduleJob } from '@opencode-manager/shared/types'
import { getProvidersWithModels } from '@/api/providers'
import { createOpenCodeClient } from '@/api/opencode'
import { settingsApi } from '@/api/settings'
import { listRepos } from '@/api/repos'
import type { Repo } from '@/api/types'
import { OPENCODE_API_ENDPOINT } from '@/config'
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
import { Loader2 } from 'lucide-react'
import { usePromptTemplates, useDeletePromptTemplate } from '@/hooks/usePromptTemplates'
import { PromptTemplateDialog } from './PromptTemplateDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { GeneralTab } from './GeneralTab'
import { TimingTab } from './TimingTab'
import { PromptTab } from './PromptTab'
import { SkillsTab } from './SkillsTab'

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
  const [prompt, setPrompt] = useState('')
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<number | null>(null)
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [skillNotes, setSkillNotes] = useState('')
  const initialSkillSlugsRef = useRef<string[] | undefined>(undefined)
  const initialSkillNotesRef = useRef<string | undefined>(undefined)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | undefined>(undefined)
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null)

  const { data: templates = [] } = usePromptTemplates()
  const deleteTemplateMutation = useDeletePromptTemplate()

  const { data: providerModels = [] } = useQuery({
    queryKey: ['providers-with-models', 'schedule-dialog'],
    queryFn: () => getProvidersWithModels(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { data: agents = [] } = useQuery({
    queryKey: ['opencode-agents', 'schedule-dialog'],
    queryFn: async () => {
      const client = createOpenCodeClient(OPENCODE_API_ENDPOINT)
      return await client.listAgents()
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { data: skills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ['managed-skills'],
    queryFn: () => settingsApi.listManagedSkills(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { data: openCodeConfig } = useQuery({
    queryKey: ['opencode-config', 'schedule-dialog'],
    queryFn: async () => {
      const client = createOpenCodeClient(OPENCODE_API_ENDPOINT)
      return await client.getConfig()
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const { data: repos = [] } = useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open && !!showRepoSelector,
    staleTime: 5 * 60 * 1000,
  })

  const repoOptions = useMemo<ComboboxOption[]>(() =>
    repos
      .filter((repo) => repo.cloneStatus === 'ready')
      .map((repo) => ({
        value: repo.id.toString(),
        label: getRepoDisplayName(repo.repoUrl, repo.localPath, repo.sourcePath),
        description: repo.localPath,
      })),
    [repos]
  )

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const configuredModels: ComboboxOption[] = []
    const configuredValues = new Set<string>()

    for (const configModel of [openCodeConfig?.model, openCodeConfig?.small_model]) {
      if (!configModel || configuredValues.has(configModel)) continue
      configuredValues.add(configModel)
      const [providerId, ...modelParts] = configModel.split('/')
      const modelId = modelParts.join('/')
      const provider = providerModels.find((p) => p.id === providerId)
      const providerModel = provider?.models.find((m) => m.id === modelId)
      configuredModels.push({
        value: configModel,
        label: providerModel?.name || modelId,
        description: configModel,
        group: 'Configured',
      })
    }

    const allModels = providerModels.flatMap((provider) =>
      provider.models
        .filter((providerModel) => !configuredValues.has(`${provider.id}/${providerModel.id}`))
        .map((providerModel) => ({
          value: `${provider.id}/${providerModel.id}`,
          label: providerModel.name || providerModel.id,
          description: `${provider.id}/${providerModel.id}`,
          group: provider.name,
        })),
    )

    return [...configuredModels, ...allModels]
  }, [providerModels, openCodeConfig])

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    return agents.map((agent) => ({
      value: agent.name,
      label: agent.name,
      description: agent.description,
    }))
  }, [agents])

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
    setPrompt(job?.prompt ?? '')
    const matchingTemplate = templates.find((template) => template.prompt === (job?.prompt ?? ''))
    setSelectedPromptTemplateId(matchingTemplate ? matchingTemplate.id : null)
    const initialSkillSlugs = job?.skillMetadata?.skillSlugs ?? []
    const initialSkillNotes = job?.skillMetadata?.notes ?? ''
    setSkillSlugs(initialSkillSlugs)
    setSkillNotes(initialSkillNotes)
    initialSkillSlugsRef.current = initialSkillSlugs
    initialSkillNotesRef.current = initialSkillNotes
  }, [job, open, templates])

  const applyPromptTemplate = (template: PromptTemplate) => {
    setSelectedPromptTemplateId(template.id)
    setName(template.suggestedName)
    setDescription(template.suggestedDescription)
    setPrompt(template.prompt)
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
      agentSlug: agentSlug.trim() || undefined,
      model: model.trim() || undefined,
      prompt: prompt.trim(),
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
        className="flex h-dvh max-h-dvh w-full max-w-4xl flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-lg sm:h-[min(85vh,760px)] sm:max-h-[85vh] sm:w-[calc(100vw-1rem)]"
      >
        <DialogHeader className="shrink-0 space-y-1 px-3 sm:px-6 pt-6 pb-3 pr-14">
          <DialogTitle>{job ? 'Edit schedule' : 'New schedule'}</DialogTitle>
          <DialogDescription className="mt-0">
            Create a reusable repo job with a visual schedule builder, manual runs, and optional advanced metadata.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-3 sm:px-6 pb-3">
            <TabsList className="grid h-9 w-full grid-cols-4 bg-card p-0.5">
              <TabsTrigger value="basics" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">General</TabsTrigger>
              <TabsTrigger value="timing" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Timing</TabsTrigger>
              <TabsTrigger value="prompt" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Prompt</TabsTrigger>
              <TabsTrigger value="skills" className="h-8 px-2 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Skills</TabsTrigger>
            </TabsList>
          </div>

          <GeneralTab
            name={name}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            agentSlug={agentSlug}
            onAgentSlugChange={setAgentSlug}
            agentOptions={agentOptions}
            model={model}
            onModelChange={setModel}
            modelOptions={modelOptions}
            enabled={enabled}
            onEnabledChange={setEnabled}
            showRepoSelector={showRepoSelector}
            isEditing={!!job}
            repoId={selectedRepoId}
            onRepoChange={onRepoChange}
            repoOptions={repoOptions}
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
        </Tabs>

        <div className="mt-0 shrink-0 border-t border-border px-3 sm:px-6 py-4 flex flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !name.trim() || !prompt.trim() || isScheduleConfigInvalid || (!!showRepoSelector && !job && !selectedRepoId)} className="flex-1 sm:flex-none">
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
