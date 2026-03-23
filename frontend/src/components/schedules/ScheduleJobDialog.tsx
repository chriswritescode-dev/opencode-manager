import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, PromptTemplate, ScheduleJob } from '@opencode-manager/shared/types'
import { getProvidersWithModels } from '@/api/providers'
import { createOpenCodeClient } from '@/api/opencode'
import { settingsApi } from '@/api/settings'
import { listRepos } from '@/api/repos'
import type { Repo } from '@/api/types'
import { OPENCODE_API_ENDPOINT } from '@/config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MultiSelect } from '@/components/ui/multi-select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  buildCronExpressionFromPreset,
  cronPresetOptions,
  detectSchedulePreset,
  formatDraftScheduleSummary,
  getLocalTimeZone,
  intervalOptions,
  schedulePresetOptions,
  type SchedulePreset,
  weekdayOptions,
} from '@/components/schedules/schedule-utils'
import { getRepoDisplayName } from '@/lib/utils'
import { Check, Info, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { usePromptTemplates, useDeletePromptTemplate } from '@/hooks/usePromptTemplates'
import { PromptTemplateDialog } from './PromptTemplateDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'

type ScheduleJobDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  job?: ScheduleJob
  isSaving: boolean
  onSubmit: (data: CreateScheduleJobRequest) => void
  showRepoSelector?: boolean
  repoId?: number
  onRepoChange?: (repoId: number | undefined) => void
}

function InfoHint({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  )
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

          <TabsContent value="basics" className="mt-0 min-h-0 flex-1 overflow-y-auto pt-4 pb-5">
            <div className="space-y-4">
              {showRepoSelector && !job && (
                <div className="space-y-2">
                  <Label>Repository</Label>
                  <Combobox
                    value={selectedRepoId?.toString() ?? ''}
                    onChange={(value) => onRepoChange?.(value ? Number(value) : undefined)}
                    options={repoOptions}
                    placeholder="Select a repository"
                    allowCustomValue={false}
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="schedule-name">Name</Label>
                  <Input id="schedule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightly repo health check" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule-description">Description</Label>
                  <Input id="schedule-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this job checks or produces" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="schedule-agent">Agent slug</Label>
                  <Combobox
                    value={agentSlug}
                    onChange={setAgentSlug}
                    options={agentOptions}
                    placeholder="Select an agent"
                    allowCustomValue
                    showClear
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="schedule-model">Model override</Label>
                    <InfoHint text="Pick from detected OpenCode models or type a custom provider/model value." />
                  </div>
                  <Combobox
                    value={model}
                    onChange={setModel}
                    options={modelOptions}
                    placeholder="Workspace default"
                    allowCustomValue
                    showClear
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Enabled</p>
                    <InfoHint text="Auto-run this job on its schedule while still allowing manual runs from the dashboard." />
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="timing" className="px-3 mt-0 min-h-0 flex-1 overflow-y-auto sm:px-6 pt-4 pb-5">
            <div className="space-y-4">
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div>
                  <Label>Repeat</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Use a simple scheduler builder by default. Advanced cron is still available if you need it.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {schedulePresetOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={schedulePreset === option.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSchedulePreset(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              {schedulePreset === 'interval' ? (
                <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="schedule-interval">Run every</Label>
                    <Input
                      id="schedule-interval"
                      type="number"
                      min={5}
                      max={10080}
                      value={intervalMinutes}
                      onChange={(event) => setIntervalMinutes(event.target.value)}
                      className="w-28"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {intervalOptions.map((option) => (
                      <Button key={option.value} type="button" variant={intervalMinutes === String(option.value) ? 'default' : 'outline'} size="sm" onClick={() => setIntervalMinutes(String(option.value))}>
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : schedulePreset === 'hourly' ? (
                <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="schedule-hourly-minute">Minute</Label>
                    <Input
                      id="schedule-hourly-minute"
                      type="number"
                      min={0}
                      max={59}
                      value={hourlyMinute}
                      onChange={(event) => setHourlyMinute(event.target.value)}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">Run every hour at the selected minute mark.</p>
                </div>
              ) : schedulePreset === 'daily' || schedulePreset === 'weekdays' ? (
                <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="schedule-time">Time</Label>
                    <Input id="schedule-time" type="time" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-timezone">Timezone</Label>
                    <Input id="schedule-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Detected from browser" />
                  </div>
                </div>
              ) : schedulePreset === 'weekly' ? (
                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <div className="space-y-2">
                    <Label>Days</Label>
                    <div className="flex flex-wrap gap-2">
                      {weekdayOptions.map((option) => {
                        const selected = weeklyDays.includes(option.value)

                        return (
                          <Button
                            key={option.value}
                            type="button"
                            variant={selected ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setWeeklyDays((current) => selected ? current.filter((value) => value !== option.value) : [...current, option.value])}
                          >
                            {option.label}
                          </Button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="schedule-weekly-time">Time</Label>
                      <Input id="schedule-weekly-time" type="time" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="schedule-weekly-timezone">Timezone</Label>
                      <Input id="schedule-weekly-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Detected from browser" />
                    </div>
                  </div>
                </div>
              ) : schedulePreset === 'monthly' ? (
                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="schedule-monthly-day">Day</Label>
                      <Input
                        id="schedule-monthly-day"
                        type="number"
                        min={1}
                        max={31}
                        value={monthlyDay}
                        onChange={(event) => setMonthlyDay(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="schedule-monthly-time">Time</Label>
                      <Input id="schedule-monthly-time" type="time" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="schedule-monthly-timezone">Timezone</Label>
                      <Input id="schedule-monthly-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Detected from browser" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <div className="space-y-2">
                    <Label htmlFor="schedule-cron">Cron expression</Label>
                    <Input
                      id="schedule-cron"
                      value={cronExpression}
                      onChange={(event) => setCronExpression(event.target.value)}
                      placeholder="0 9 * * 1-5"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">Examples: `0 9 * * 1-5` weekdays at 9 AM, `30 6 1 * *` monthly on the 1st at 6:30 AM.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="schedule-timezone">Timezone</Label>
                    <Input
                      id="schedule-timezone"
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                      placeholder="Detected from browser"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {cronPresetOptions.map((option) => (
                      <Button key={option.value} type="button" variant="outline" size="sm" onClick={() => setCronExpression(option.value)}>
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Schedule Preview</p>
                <p className="mt-2 text-sm font-medium break-words">{formatDraftScheduleSummary({ preset: schedulePreset, intervalMinutes, timeOfDay, hourlyMinute, weeklyDays, monthlyDay, cronExpression, timezone })}</p>
                {schedulePreset !== 'interval' && (
                  <p className="mt-2 text-xs text-muted-foreground font-mono break-all">
                    {buildCronExpressionFromPreset({ preset: schedulePreset, intervalMinutes, timeOfDay, hourlyMinute, weeklyDays, monthlyDay, cronExpression })}
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="prompt" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-5 sm:px-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <Label>Prompt templates</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => { setEditingTemplate(undefined); setTemplateDialogOpen(true) }}
                  >
                    <Plus className="h-3 w-3" />
                    New
                  </Button>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {templates.map((template) => {
                    const isSelected = selectedPromptTemplateId === template.id

                    return (
                      <div key={template.id} className="relative group">
                        <button
                          type="button"
                          onClick={() => applyPromptTemplate(template)}
                          className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                            isSelected
                              ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                              : 'border-border bg-card hover:bg-accent/40'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="text-[10px] uppercase tracking-wide border-transparent bg-orange-500 text-white">
                              {template.category}
                            </Badge>
                            <Badge className="text-[10px] uppercase tracking-wide border-transparent bg-slate-600 text-white">
                              {template.cadenceHint}
                            </Badge>
                          </div>
                          <div className="mt-3">
                            <p className="text-sm font-semibold">{template.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground line-clamp-3">{template.suggestedDescription}</p>
                          {isSelected && (
                            <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                              <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                        </button>
                        <div className={`absolute top-2 right-10 flex gap-1 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); setEditingTemplate(template); setTemplateDialogOpen(true) }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeletingTemplateId(template.id) }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedule-prompt">Prompt</Label>
                <Textarea
                  id="schedule-prompt"
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value)
                    setSelectedPromptTemplateId(null)
                  }}
                  className="min-h-[320px]"
                  placeholder="Review the repo, summarize notable risks, and open a session I can inspect later."
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This prompt becomes the first message sent to the agent when the schedule runs.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="skills" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select skills for this schedule</Label>
                <p className="text-xs text-muted-foreground">
                  Skills provide domain-specific instructions to the agent. Select which skills should be available when this schedule runs.
                </p>
              </div>

              {skillsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : skills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center">
                  <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No skills discovered. Configure skill paths in Settings to make skills available here.</p>
                </div>
              ) : (
                <MultiSelect
                  value={skillSlugs}
                  onChange={setSkillSlugs}
                  options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
                  placeholder="Search and select skills..."
                />
              )}

              <div className="space-y-2">
                <Label htmlFor="schedule-skill-notes">Notes</Label>
                <Textarea
                  id="schedule-skill-notes"
                  value={skillNotes}
                  onChange={(event) => setSkillNotes(event.target.value)}
                  placeholder="Optional notes about skill usage for this schedule."
                  className="min-h-[80px]"
                />
              </div>
            </div>
          </TabsContent>
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
