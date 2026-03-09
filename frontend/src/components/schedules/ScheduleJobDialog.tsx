import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, ScheduleJob } from '@opencode-manager/shared/types'
import { getProvidersWithModels } from '@/api/providers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  promptTemplateOptions,
  schedulePresetOptions,
  type PromptTemplateOption,
  type SchedulePreset,
  weekdayOptions,
} from '@/components/schedules/schedule-utils'
import { Info, Loader2, Sparkles } from 'lucide-react'

type ScheduleJobDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  job?: ScheduleJob
  isSaving: boolean
  onSubmit: (data: CreateScheduleJobRequest) => void
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

export function ScheduleJobDialog({ open, onOpenChange, job, isSaving, onSubmit }: ScheduleJobDialogProps) {
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
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<string | null>(null)
  const [skillSlugs, setSkillSlugs] = useState('')
  const [skillNotes, setSkillNotes] = useState('')

  const { data: providerModels = [] } = useQuery({
    queryKey: ['providers-with-models', 'schedule-dialog'],
    queryFn: () => getProvidersWithModels(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    return providerModels.flatMap((provider) =>
      provider.models.map((providerModel) => ({
        value: `${provider.id}/${providerModel.id}`,
        label: providerModel.name || providerModel.id,
        description: `${provider.id}/${providerModel.id}`,
        group: provider.name,
      })),
    )
  }, [providerModels])

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
    setSelectedPromptTemplateId(promptTemplateOptions.find((template) => template.prompt === (job?.prompt ?? ''))?.id ?? null)
    setSkillSlugs(job?.skillMetadata?.skillSlugs.join(', ') ?? '')
    setSkillNotes(job?.skillMetadata?.notes ?? '')
  }, [job, open])

  const applyPromptTemplate = (template: PromptTemplateOption) => {
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
    const baseFields = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      agentSlug: agentSlug.trim() || undefined,
      model: model.trim() || undefined,
      prompt: prompt.trim(),
      skillMetadata: skillSlugs.trim() || skillNotes.trim()
        ? {
            skillSlugs: skillSlugs.split(',').map((value) => value.trim()).filter(Boolean),
            notes: skillNotes.trim() || undefined,
          }
        : undefined,
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
        className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden border-border bg-background p-0 shadow-lg sm:h-[min(85vh,760px)] sm:max-h-[85vh]"
      >
        <DialogHeader className="shrink-0 space-y-1 px-6 pt-6 pb-3 pr-14">
          <DialogTitle>{job ? 'Edit schedule' : 'New schedule'}</DialogTitle>
          <DialogDescription className="mt-0">
            Create a reusable repo job with a visual schedule builder, manual runs, and optional advanced metadata.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-6 pb-3">
            <TabsList className="grid h-9 w-full grid-cols-4 bg-card p-0.5">
              <TabsTrigger value="basics" className="h-8 px-2 text-xs sm:text-sm">General</TabsTrigger>
              <TabsTrigger value="timing" className="h-8 px-2 text-xs sm:text-sm">Timing</TabsTrigger>
              <TabsTrigger value="prompt" className="h-8 px-2 text-xs sm:text-sm">Prompt</TabsTrigger>
              <TabsTrigger value="skills" className="h-8 px-2 text-xs sm:text-sm">Advanced</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="basics" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
            <div className="space-y-4">
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
                  <Input id="schedule-agent" value={agentSlug} onChange={(event) => setAgentSlug(event.target.value)} placeholder="code" />
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

          <TabsContent value="timing" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
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

          <TabsContent value="prompt" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Prompt templates</Label>
                  <p className="text-xs text-muted-foreground">Applying a template fills the name, description, and prompt.</p>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {promptTemplateOptions.map((template) => {
                    const isSelected = selectedPromptTemplateId === template.id

                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applyPromptTemplate(template)}
                        className={`rounded-xl border p-4 text-left transition-colors ${isSelected ? 'border-primary/30 bg-accent' : 'border-border bg-card hover:bg-accent/40'}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{template.category}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{template.cadenceHint}</Badge>
                        </div>
                        <div className="mt-3">
                          <p className="text-sm font-semibold">{template.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground line-clamp-3">{template.suggestedDescription}</p>
                      </button>
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
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="space-y-1">
                  <h3 className="text-base font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> Optional future integrations</h3>
                  <p className="text-sm text-muted-foreground">You can ignore this for now. These fields are stored for future skill-aware scheduling, but the current MVP does not use them during execution.</p>
                </div>
              </section>

              <details className="group rounded-lg border border-dashed border-border bg-card/50 p-4">
                <summary className="cursor-pointer list-none text-sm font-medium">Edit optional skill metadata</summary>
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="schedule-skills">Skill tags</Label>
                    <Input id="schedule-skills" value={skillSlugs} onChange={(event) => setSkillSlugs(event.target.value)} placeholder="nextjs, database-tuning" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-skill-notes">Notes</Label>
                    <Textarea id="schedule-skill-notes" value={skillNotes} onChange={(event) => setSkillNotes(event.target.value)} placeholder="Optional notes for a future skill-aware scheduler." />
                  </div>
                </div>
              </details>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-0 shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !name.trim() || !prompt.trim() || isScheduleConfigInvalid}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? 'Saving...' : job ? 'Save changes' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
