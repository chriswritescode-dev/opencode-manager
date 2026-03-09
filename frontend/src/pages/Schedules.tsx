import { useEffect, useMemo, useState } from 'react'
import cronstrue from 'cronstrue'
import { formatDistanceToNow } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { CreateScheduleJobRequest, ScheduleJob, ScheduleRun, UpdateScheduleJobRequest } from '@opencode-manager/shared/types'
import { getRepo } from '@/api/repos'
import {
  useCancelRepoScheduleRun,
  useCreateRepoSchedule,
  useDeleteRepoSchedule,
  useRepoSchedule,
  useRepoScheduleRuns,
  useRepoSchedules,
  useRunRepoSchedule,
  useUpdateRepoSchedule,
} from '@/hooks/useSchedules'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { markdownComponents } from '@/components/file-browser/MarkdownComponents'
import { getRepoDisplayName } from '@/lib/utils'
import { getProvidersWithModels } from '@/api/providers'
import {
  Bot,
  CalendarClock,
  ChevronDown,
  Clock3,
  History,
  Info,
  Loader2,
  Play,
  Plus,
  Square,
  Sparkles,
  TerminalSquare,
  Trash2,
  Pencil,
} from 'lucide-react'

const intervalOptions = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '1d', value: 1440 },
]

const cronPresetOptions = [
  { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
  { label: 'Daily 9 AM', value: '0 9 * * *' },
  { label: 'Twice daily', value: '0 9,17 * * *' },
  { label: 'Mondays 8 AM', value: '0 8 * * 1' },
]

type PromptTemplateOption = {
  id: string
  title: string
  category: string
  cadenceHint: string
  suggestedName: string
  suggestedDescription: string
  description: string
  prompt: string
}

const promptTemplateOptions: PromptTemplateOption[] = [
  {
    id: 'repo-health-report',
    title: 'Repo Health Report',
    category: 'Health',
    cadenceHint: 'Weekly',
    suggestedName: 'Weekly repo health report',
    suggestedDescription: 'Summarize code health, risk areas, and the next highest-leverage follow-ups.',
    description: 'A broad weekly review of project health, risks, and recommended next actions.',
    prompt: [
      'Review this repository and prepare a concise weekly health report.',
      '',
      'Focus on:',
      '- overall code health and maintainability signals',
      '- risky or stale areas in the codebase',
      '- flaky, fragile, or untested workflows',
      '- notable recent drift in tooling, scripts, or structure',
      '',
      'Do not modify files or create commits.',
      '',
      'Return the result in these sections:',
      '1. Overall Status',
      '2. Key Risks',
      '3. What Changed or Drifted',
      '4. Recommended Next Actions',
    ].join('\n'),
  },
  {
    id: 'dependency-watch',
    title: 'Dependency Watchlist',
    category: 'Maintenance',
    cadenceHint: 'Weekly',
    suggestedName: 'Dependency watchlist',
    suggestedDescription: 'Review dependency health, upgrade pressure, and risky package drift.',
    description: 'Surfaces outdated, risky, or inconsistent dependencies and upgrade priorities.',
    prompt: [
      'Audit this repository for dependency risk and upgrade pressure.',
      '',
      'Inspect package manifests, lockfiles, build tooling, runtime dependencies, and obvious version drift.',
      '',
      'Focus on:',
      '- outdated or inconsistent package versions',
      '- packages that look risky, abandoned, duplicated, or unnecessary',
      '- tooling mismatches that could cause local vs CI drift',
      '- high-priority upgrades to tackle next',
      '',
      'Do not change files.',
      '',
      'Return:',
      '1. Highest Priority Upgrades',
      '2. Risky or Inconsistent Dependencies',
      '3. Tooling Drift',
      '4. Suggested Upgrade Order',
    ].join('\n'),
  },
  {
    id: 'release-readiness',
    title: 'Release Readiness Review',
    category: 'Release',
    cadenceHint: 'Before release',
    suggestedName: 'Release readiness review',
    suggestedDescription: 'Check whether the repo looks ready to ship and what could block release confidence.',
    description: 'A pre-release checkpoint for blockers, missing validation, and confidence gaps.',
    prompt: [
      'Review this repository for release readiness.',
      '',
      'Focus on anything that would reduce confidence in shipping soon, including:',
      '- missing validation, tests, or smoke coverage',
      '- fragile configuration or deployment assumptions',
      '- unfinished, ambiguous, or risky recent work',
      '- docs or scripts that appear stale relative to the implementation',
      '',
      'Do not edit files.',
      '',
      'Return:',
      '1. Release Confidence',
      '2. Blockers',
      '3. Follow-ups Before Shipping',
      '4. Nice-to-have Cleanup After Release',
    ].join('\n'),
  },
  {
    id: 'test-stability-audit',
    title: 'Test Stability Audit',
    category: 'Quality',
    cadenceHint: 'Weekly',
    suggestedName: 'Test stability audit',
    suggestedDescription: 'Find flaky areas, missing coverage signals, and brittle testing patterns.',
    description: 'Looks at test quality, slow paths, brittle coverage, and likely flaky areas.',
    prompt: [
      'Inspect this repository for test stability and coverage risk.',
      '',
      'Focus on:',
      '- flaky or brittle test patterns',
      '- important product areas with weak or missing coverage',
      '- slow or overcomplicated test flows',
      '- test setup/config problems that could cause false confidence',
      '',
      'Do not modify files.',
      '',
      'Return:',
      '1. Confidence Gaps',
      '2. Flaky or Fragile Areas',
      '3. Coverage Priorities',
      '4. Suggested Test Improvements',
    ].join('\n'),
  },
  {
    id: 'docs-drift-review',
    title: 'Docs Drift Review',
    category: 'Docs',
    cadenceHint: 'Biweekly',
    suggestedName: 'Docs drift review',
    suggestedDescription: 'Check whether README, setup steps, and docs still match the current repo.',
    description: 'Finds README/setup/documentation drift relative to the actual codebase.',
    prompt: [
      'Review this repository for documentation drift.',
      '',
      'Compare README files, setup instructions, scripts, and other repo docs against the actual implementation and project structure.',
      '',
      'Focus on:',
      '- stale setup or run instructions',
      '- missing documentation for important workflows',
      '- docs that no longer match the codebase structure or tooling',
      '- confusing or duplicated documentation',
      '',
      'Do not edit files.',
      '',
      'Return:',
      '1. Docs That Look Stale',
      '2. Missing Documentation',
      '3. Confusing or Conflicting Guidance',
      '4. Suggested Documentation Updates',
    ].join('\n'),
  },
  {
    id: 'tech-debt-triage',
    title: 'Tech Debt Triage',
    category: 'Planning',
    cadenceHint: 'Weekly',
    suggestedName: 'Tech debt triage',
    suggestedDescription: 'Identify the most expensive sources of drag and rank cleanup opportunities.',
    description: 'Ranks the most valuable cleanup and refactor opportunities in the repo.',
    prompt: [
      'Review this repository and identify the most important technical debt to address next.',
      '',
      'Focus on debt that creates drag for delivery, reliability, or maintainability, such as:',
      '- duplicated logic or tangled ownership',
      '- brittle architecture seams',
      '- outdated patterns or confusing abstractions',
      '- hotspots that are hard to safely change',
      '',
      'Do not make changes.',
      '',
      'Return:',
      '1. Top Technical Debt Items',
      '2. Why Each Item Matters',
      '3. Cost vs Impact',
      '4. Recommended Cleanup Order',
    ].join('\n'),
  },
  {
    id: 'security-config-review',
    title: 'Security and Config Review',
    category: 'Security',
    cadenceHint: 'Weekly',
    suggestedName: 'Security and config review',
    suggestedDescription: 'Inspect obvious security, secrets, and environment/config handling risks.',
    description: 'Looks for obvious secrets, auth, and configuration handling issues.',
    prompt: [
      'Inspect this repository for obvious security and configuration handling risks.',
      '',
      'Focus on:',
      '- secrets or credentials handling problems',
      '- risky defaults in environment or auth configuration',
      '- places where permission checks or trust assumptions look weak',
      '- config sprawl that could cause unsafe deployments',
      '',
      'Stay read-only. Do not modify files.',
      '',
      'Return:',
      '1. High-Risk Findings',
      '2. Medium-Risk Findings',
      '3. Configuration Concerns',
      '4. Recommended Fixes',
    ].join('\n'),
  },
  {
    id: 'ci-ops-review',
    title: 'CI and Ops Review',
    category: 'Operations',
    cadenceHint: 'Weekly',
    suggestedName: 'CI and ops review',
    suggestedDescription: 'Check CI, scripts, and operational workflows for fragility or drift.',
    description: 'Surfaces friction or fragility in CI, automation, and repo operations.',
    prompt: [
      'Review this repository for CI, automation, and operational workflow issues.',
      '',
      'Focus on:',
      '- brittle build or test assumptions',
      '- scripts that look stale, redundant, or inconsistent',
      '- automation that appears slow, noisy, or easy to break',
      '- workflow gaps that could hurt developer reliability',
      '',
      'Do not edit files.',
      '',
      'Return:',
      '1. Operational Risks',
      '2. CI or Automation Drift',
      '3. Reliability Improvements',
      '4. Highest-Leverage Next Steps',
    ].join('\n'),
  },
  {
    id: 'onboarding-brief',
    title: 'Onboarding Brief',
    category: 'Knowledge',
    cadenceHint: 'Monthly',
    suggestedName: 'Onboarding brief refresh',
    suggestedDescription: 'Produce a concise orientation summary for someone new to the repo.',
    description: 'Creates a concise orientation guide for engineers who are new to the repo.',
    prompt: [
      'Prepare an onboarding brief for an engineer who is new to this repository.',
      '',
      'Focus on:',
      '- the repo structure and major areas of responsibility',
      '- the core development workflows and important commands',
      '- risky or confusing areas worth knowing early',
      '- where a new engineer should start reading or exploring',
      '',
      'Do not modify files.',
      '',
      'Return:',
      '1. What This Repo Does',
      '2. Important Areas to Know',
      '3. Local Workflow Cheatsheet',
      '4. Common Pitfalls and First Reading List',
    ].join('\n'),
  },
  {
    id: 'memory-candidate-review',
    title: 'Memory Candidate Review',
    category: 'Knowledge',
    cadenceHint: 'Biweekly',
    suggestedName: 'Memory candidate review',
    suggestedDescription: 'Identify stable conventions, decisions, and context worth preserving as memory.',
    description: 'Great for repos using durable memory or team conventions that should be captured.',
    prompt: [
      'Review this repository and identify durable knowledge worth preserving as long-lived memory.',
      '',
      'Focus on conventions, architectural decisions, recurring workflows, and stable context that future sessions should know.',
      '',
      'Do not create or update memory directly. Just recommend candidates.',
      '',
      'Return:',
      '1. Candidate Conventions',
      '2. Candidate Decisions',
      '3. Candidate Context',
      '4. Why Each Item Should Be Preserved',
    ].join('\n'),
  },
]

const schedulePresetOptions = [
  { label: 'Interval', value: 'interval' },
  { label: 'Hourly', value: 'hourly' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Advanced', value: 'advanced' },
] as const

const weekdayOptions = [
  { label: 'Mon', value: '1' },
  { label: 'Tue', value: '2' },
  { label: 'Wed', value: '3' },
  { label: 'Thu', value: '4' },
  { label: 'Fri', value: '5' },
  { label: 'Sat', value: '6' },
  { label: 'Sun', value: '0' },
] as const

type SchedulePreset = typeof schedulePresetOptions[number]['value']

function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isNumericToken(value: string): boolean {
  return /^\d+$/.test(value)
}

function parseTimeValue(value: string): { hour: number; minute: number } {
  const [hourValue = '9', minuteValue = '0'] = value.split(':')
  const hour = Number.parseInt(hourValue, 10)
  const minute = Number.parseInt(minuteValue, 10)

  return {
    hour: Number.isNaN(hour) ? 9 : Math.min(Math.max(hour, 0), 23),
    minute: Number.isNaN(minute) ? 0 : Math.min(Math.max(minute, 0), 59),
  }
}

function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function expandDayOfWeekExpression(expression: string): string[] | null {
  const days = new Set<string>()

  for (const token of expression.split(',')) {
    const trimmedToken = token.trim()

    if (!trimmedToken) {
      continue
    }

    if (isNumericToken(trimmedToken)) {
      const normalized = trimmedToken === '7' ? '0' : trimmedToken
      if (!weekdayOptions.some((option) => option.value === normalized)) {
        return null
      }
      days.add(normalized)
      continue
    }

    const rangeMatch = trimmedToken.match(/^(\d)-(\d)$/)
    if (rangeMatch) {
      const start = rangeMatch[1] === '7' ? 0 : Number.parseInt(rangeMatch[1], 10)
      const end = rangeMatch[2] === '7' ? 0 : Number.parseInt(rangeMatch[2], 10)

      if (start > end) {
        return null
      }

      for (let value = start; value <= end; value += 1) {
        days.add(String(value))
      }
      continue
    }

    return null
  }

  return weekdayOptions.filter((option) => days.has(option.value)).map((option) => option.value)
}

function sortWeekdayValues(values: string[]): string[] {
  const order = new Map<string, number>(weekdayOptions.map((option, index) => [option.value, index]))
  return [...new Set(values)].sort((left, right) => (order.get(left) ?? 99) - (order.get(right) ?? 99))
}

function detectSchedulePreset(job?: ScheduleJob): {
  preset: SchedulePreset
  intervalMinutes: string
  timeOfDay: string
  hourlyMinute: string
  weeklyDays: string[]
  monthlyDay: string
  cronExpression: string
  timezone: string
} {
  const defaultTimezone = job?.timezone ?? getLocalTimeZone()
  const defaults = {
    preset: 'interval' as SchedulePreset,
    intervalMinutes: String(job?.intervalMinutes ?? 60),
    timeOfDay: '09:00',
    hourlyMinute: '0',
    weeklyDays: ['1'],
    monthlyDay: '1',
    cronExpression: job?.cronExpression ?? '0 9 * * 1-5',
    timezone: defaultTimezone,
  }

  if (!job || job.scheduleMode === 'interval') {
    return defaults
  }

  const expression = job.cronExpression?.trim() ?? ''
  const fields = expression.split(/\s+/)
  if (fields.length !== 5) {
    return { ...defaults, preset: 'advanced', cronExpression: expression || defaults.cronExpression }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (!isNumericToken(minute)) {
    return { ...defaults, preset: 'advanced', cronExpression: expression }
  }

  if (month === '*' && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return {
      ...defaults,
      preset: 'hourly',
      hourlyMinute: minute,
      cronExpression: expression,
    }
  }

  if (!isNumericToken(hour)) {
    return { ...defaults, preset: 'advanced', cronExpression: expression }
  }

  const timeOfDay = toTimeValue(Number.parseInt(hour, 10), Number.parseInt(minute, 10))

  if (month === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return { ...defaults, preset: 'daily', timeOfDay, cronExpression: expression }
  }

  if (month === '*' && dayOfMonth === '*' && dayOfWeek === '1-5') {
    return { ...defaults, preset: 'weekdays', timeOfDay, cronExpression: expression, weeklyDays: ['1', '2', '3', '4', '5'] }
  }

  if (month === '*' && dayOfMonth === '*') {
    const weeklyDays = expandDayOfWeekExpression(dayOfWeek)
    if (weeklyDays && weeklyDays.length > 0) {
      return { ...defaults, preset: 'weekly', timeOfDay, weeklyDays, cronExpression: expression }
    }
  }

  if (month === '*' && dayOfWeek === '*' && isNumericToken(dayOfMonth)) {
    return {
      ...defaults,
      preset: 'monthly',
      timeOfDay,
      monthlyDay: dayOfMonth,
      cronExpression: expression,
    }
  }

  return { ...defaults, preset: 'advanced', timeOfDay, cronExpression: expression }
}

function buildCronExpressionFromPreset(input: {
  preset: SchedulePreset
  intervalMinutes?: string
  timeOfDay: string
  hourlyMinute: string
  weeklyDays: string[]
  monthlyDay: string
  cronExpression: string
}): string {
  const { hour, minute } = parseTimeValue(input.timeOfDay)

  switch (input.preset) {
    case 'hourly':
      return `${Math.min(Math.max(Number.parseInt(input.hourlyMinute, 10) || 0, 0), 59)} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`
    case 'weekly':
      return `${minute} ${hour} * * ${sortWeekdayValues(input.weeklyDays).join(',') || '1'}`
    case 'monthly':
      return `${minute} ${hour} ${Math.min(Math.max(Number.parseInt(input.monthlyDay, 10) || 1, 1), 31)} * *`
    case 'advanced':
      return input.cronExpression.trim()
    default:
      return input.cronExpression.trim()
  }
}

function formatIntervalLabel(intervalMinutes: number | null): string {
  if (!intervalMinutes) {
    return 'Custom interval'
  }

  if (intervalMinutes % 1440 === 0) {
    const days = intervalMinutes / 1440
    return `Every ${days} day${days === 1 ? '' : 's'}`
  }

  if (intervalMinutes % 60 === 0) {
    const hours = intervalMinutes / 60
    return `Every ${hours} hour${hours === 1 ? '' : 's'}`
  }

  return `Every ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'}`
}

function formatCronHumanText(cronExpression: string | null): string | null {
  if (!cronExpression) {
    return null
  }

  try {
    return cronstrue.toString(cronExpression, {
      throwExceptionOnParseError: true,
      use24HourTimeFormat: false,
    })
  } catch {
    return null
  }
}

function formatScheduleSummary(job: ScheduleJob): string {
  if (job.scheduleMode === 'cron') {
    return `${formatCronHumanText(job.cronExpression) ?? (job.cronExpression ?? 'Custom cron')}${job.timezone ? ` - ${job.timezone}` : ''}`
  }

  return formatIntervalLabel(job.intervalMinutes)
}

function formatScheduleShortLabel(job: ScheduleJob): string {
  if (job.scheduleMode === 'cron') {
    return 'Cron schedule'
  }

  return formatIntervalLabel(job.intervalMinutes)
}

function formatDraftScheduleSummary(input: {
  preset: SchedulePreset
  intervalMinutes: string
  timeOfDay: string
  hourlyMinute: string
  weeklyDays: string[]
  monthlyDay: string
  cronExpression: string
  timezone: string
}): string {
  if (input.preset === 'interval') {
    const parsedInterval = Number.parseInt(input.intervalMinutes, 10)
    return formatIntervalLabel(Number.isNaN(parsedInterval) ? null : parsedInterval)
  }

  const builtCronExpression = buildCronExpressionFromPreset(input)
  const humanText = formatCronHumanText(builtCronExpression)

  return builtCronExpression
    ? `${humanText ?? builtCronExpression} - ${input.timezone.trim() || 'UTC'}`
    : 'Choose a schedule'
}

function toUpdateScheduleRequest(data: CreateScheduleJobRequest): UpdateScheduleJobRequest {
  if (data.scheduleMode === 'cron') {
    return {
      ...data,
      description: data.description ?? null,
      agentSlug: data.agentSlug ?? null,
      model: data.model ?? null,
      intervalMinutes: null,
    }
  }

  return {
    ...data,
    description: data.description ?? null,
    agentSlug: data.agentSlug ?? null,
    model: data.model ?? null,
    cronExpression: null,
    timezone: null,
  }
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return 'Never'
  }

  return `${new Date(value).toLocaleString()} (${formatDistanceToNow(value, { addSuffix: true })})`
}

function getRunTone(run: ScheduleRun): string {
  if (run.status === 'completed') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  }

  if (run.status === 'failed') {
    return 'bg-red-500/15 text-red-300 border-red-500/30'
  }

  if (run.status === 'cancelled') {
    return 'bg-slate-500/15 text-slate-300 border-slate-500/30'
  }

  return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
}

function getJobStatusTone(job: ScheduleJob): string {
  return job.enabled
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    : 'bg-muted text-muted-foreground border-border'
}

function hasSkillMetadata(job?: ScheduleJob | null): boolean {
  if (!job?.skillMetadata) {
    return false
  }

  return job.skillMetadata.skillSlugs.length > 0 || Boolean(job.skillMetadata.notes?.trim())
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

function ScheduleRunMarkdown({ content }: { content: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border/60 bg-background/40">
      <div className="prose prose-invert prose-enhanced max-w-none break-words p-4 text-foreground leading-snug">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight, rehypeRaw]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}

type ScheduleJobDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  job?: ScheduleJob
  isSaving: boolean
  onSubmit: (data: CreateScheduleJobRequest) => void
}

function ScheduleJobDialog({ open, onOpenChange, job, isSaving, onSubmit }: ScheduleJobDialogProps) {
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
            {isSaving ? 'Saving...' : job ? 'Save changes' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Schedules() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = id ? Number(id) : undefined
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduleJob | undefined>()
  const [deleteJobId, setDeleteJobId] = useState<number | null>(null)

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined,
  })
  const { data: jobs, isLoading: jobsLoading } = useRepoSchedules(repoId)
  const { data: selectedJob } = useRepoSchedule(repoId, selectedJobId)
  const { data: runs, isLoading: runsLoading } = useRepoScheduleRuns(repoId, selectedJobId, 30)

  const createMutation = useCreateRepoSchedule(repoId)
  const updateMutation = useUpdateRepoSchedule(repoId)
  const deleteMutation = useDeleteRepoSchedule(repoId)
  const runMutation = useRunRepoSchedule(repoId)
  const cancelRunMutation = useCancelRepoScheduleRun(repoId)

  useEffect(() => {
    if (!jobs?.length) {
      setSelectedJobId(null)
      return
    }

    const stillExists = selectedJobId !== null && jobs.some((job) => job.id === selectedJobId)
    if (!stillExists) {
      setSelectedJobId(jobs[0]?.id ?? null)
    }
  }, [jobs, selectedJobId])

  useEffect(() => {
    if (!runs?.length) {
      setSelectedRunId(null)
      return
    }

    const stillExists = selectedRunId !== null && runs.some((run) => run.id === selectedRunId)
    if (!stillExists) {
      setSelectedRunId(runs[0]?.id ?? null)
    }
  }, [runs, selectedRunId])

  useEffect(() => {
    setDetailsExpanded(false)
  }, [selectedJobId])

  const activeRun = useMemo(() => runs?.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId])
  const runningRun = useMemo(() => runs?.find((run) => run.status === 'running') ?? null, [runs])

  if (repoLoading || jobsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!repo || repoId === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">Repository not found</p>
      </div>
    )
  }

  const repoName = getRepoDisplayName(repo.repoUrl, repo.localPath)
  const enabledCount = jobs?.filter((job) => job.enabled).length ?? 0
  const hasJobs = (jobs?.length ?? 0) > 0

  const handleCreate = (data: CreateScheduleJobRequest) => {
    createMutation.mutate(data, {
      onSuccess: (job) => {
        setSelectedJobId(job.id)
        setDialogOpen(false)
        setEditingJob(undefined)
      },
    })
  }

  const handleUpdate = (data: CreateScheduleJobRequest) => {
    if (!editingJob) {
      return
    }

    updateMutation.mutate({
      jobId: editingJob.id,
      data: toUpdateScheduleRequest(data),
    }, {
      onSuccess: () => {
        setDialogOpen(false)
        setEditingJob(undefined)
      },
    })
  }

  const handleDelete = () => {
    if (deleteJobId === null) {
      return
    }

    deleteMutation.mutate(deleteJobId, {
      onSuccess: () => {
        if (selectedJobId === deleteJobId) {
          setSelectedJobId(null)
        }
        setDeleteJobId(null)
      },
    })
  }

  const handleToggleEnabled = () => {
    if (!selectedJob) {
      return
    }

    updateMutation.mutate({
      jobId: selectedJob.id,
      data: { enabled: !selectedJob.enabled },
    })
  }

  const handleRunNow = () => {
    if (!selectedJob) {
      return
    }

    runMutation.mutate(selectedJob.id, {
      onSuccess: (run) => {
        setSelectedRunId(run.id)
      },
    })
  }

  const handleCancelRun = () => {
    if (!activeRun || activeRun.status !== 'running') {
      return
    }

    cancelRunMutation.mutate({
      jobId: activeRun.jobId,
      runId: activeRun.id,
    }, {
      onSuccess: (run) => {
        setSelectedRunId(run.id)
      },
    })
  }

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to={`/repos/${repoId}`} />
        <div className="min-w-0 flex-1 flex justify-center px-3">
          <Header.Title className="truncate">Schedules</Header.Title>
        </div>
        <Header.Actions>
          <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }} size="sm" className="hidden sm:flex">
            <Plus className="w-4 h-4 mr-2" />
            New Schedule
          </Button>
          <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }} size="sm" className="sm:hidden">
            <Plus className="w-4 h-4" />
          </Button>
        </Header.Actions>
      </Header>

      <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{repoName}</p>
              <p className="text-xs text-muted-foreground">Recurring agent jobs and their run history.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">{jobs?.length ?? 0} jobs</Badge>
              <Badge variant="outline" className="h-8 rounded-full px-3 text-xs">{enabledCount} enabled</Badge>
            </div>
          </div>

          {!hasJobs ? (
            <div className="flex min-h-0 flex-1 items-start">
              <Card className="max-w-3xl border-dashed border-border/70">
                <CardContent className="flex flex-col items-start gap-4 p-8 sm:p-10">
                  <div className="rounded-full border border-border bg-muted/40 p-3">
                    <CalendarClock className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-semibold tracking-tight">No schedules yet</p>
                    <p className="text-sm text-muted-foreground">Create a schedule for this repo to automate recurring agent work, then inspect runs, logs, and sessions here.</p>
                  </div>
                  <Button onClick={() => { setEditingJob(undefined); setDialogOpen(true) }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Schedule
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1 grid-rows-[minmax(0,240px)_minmax(0,1fr)]">
              <div className="min-h-0">
                <Card className="flex h-full min-h-0 flex-col border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Jobs</CardTitle>
                    <CardDescription>Pick a schedule to inspect, edit, or run.</CardDescription>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
                    {(jobs ?? []).map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${selectedJobId === job.id ? 'border-primary/30 bg-accent' : 'border-border/70 bg-background/60 hover:bg-accent/40'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{job.name}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{job.description || 'No description yet'}</p>
                          </div>
                          <Badge className={getJobStatusTone(job)}>{job.enabled ? 'Enabled' : 'Paused'}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatScheduleShortLabel(job)}</span>
                          <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {job.agentSlug ?? 'default agent'}</span>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="flex min-h-0 flex-col gap-4">
                {selectedJob ? (
                  <>
                    <section className="shrink-0 overflow-hidden rounded-xl border border-border/70 bg-card/40">
                      <div className="border-b border-border/60 bg-card px-6 py-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl font-semibold tracking-tight">{selectedJob.name}</h3>
                              <Badge className={getJobStatusTone(selectedJob)}>{selectedJob.enabled ? 'Enabled' : 'Paused'}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{selectedJob.description || 'No description provided.'}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatTimestamp(selectedJob.nextRunAt)}</span>
                              <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> Last run {formatTimestamp(selectedJob.lastRunAt)}</span>
                              <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatScheduleSummary(selectedJob)}</span>
                              <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {selectedJob.agentSlug ?? 'default agent'}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button variant="ghost" onClick={() => setDetailsExpanded((current) => !current)}>
                              <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
                              {detailsExpanded ? 'Collapse details' : 'Expand details'}
                            </Button>
                            <Button variant="outline" onClick={handleToggleEnabled} disabled={updateMutation.isPending}>
                              {selectedJob.enabled ? 'Pause' : 'Enable'}
                            </Button>
                            <Button variant="outline" onClick={() => { setEditingJob(selectedJob); setDialogOpen(true) }}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </Button>
                            <Button variant="outline" onClick={handleRunNow} disabled={runMutation.isPending || Boolean(runningRun)}>
                              {runMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                              {runningRun ? 'Run in progress' : 'Run now'}
                            </Button>
                            <Button variant="destructive" onClick={() => setDeleteJobId(selectedJob.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </Button>
                          </div>
                        </div>
                      </div>

                      {detailsExpanded && (
                        <div className="max-h-[45vh] overflow-y-auto p-6">
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                            <div className="space-y-4">
                              <section className="rounded-lg border border-border/60 bg-background/40 p-4">
                                <div className="mb-3">
                                  <h3 className="text-base font-medium">Execution Prompt</h3>
                                  <p className="text-sm text-muted-foreground">Sent to OpenCode as the first message in the generated session.</p>
                                </div>
                                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{selectedJob.prompt}</pre>
                              </section>

                              {hasSkillMetadata(selectedJob) && (
                                <section className="rounded-lg border border-border/60 bg-background/40 p-4">
                                  <div className="mb-3">
                                    <h3 className="text-base font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> Advanced metadata</h3>
                                    <p className="text-sm text-muted-foreground">Stored for future scheduler integrations. The current MVP does not execute against these fields yet.</p>
                                  </div>
                                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6 text-foreground/90">{JSON.stringify(selectedJob.skillMetadata, null, 2)}</pre>
                                </section>
                              )}
                            </div>

                            <Card className="border-border/60 bg-background/60 shadow-none">
                              <CardHeader>
                                <CardTitle className="text-base">Execution Settings</CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-3 text-sm">
                                <div>
                                  <p className="text-muted-foreground">Schedule</p>
                                  <p className="font-medium break-words">{formatScheduleSummary(selectedJob)}</p>
                                  {selectedJob.scheduleMode === 'cron' && selectedJob.cronExpression && (
                                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedJob.cronExpression}</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Agent</p>
                                  <p className="font-medium">{selectedJob.agentSlug ?? 'Default agent'}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Model</p>
                                  <p className="font-medium break-all">{selectedJob.model ?? 'Workspace default'}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Created</p>
                                  <p className="font-medium">{formatTimestamp(selectedJob.createdAt)}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Updated</p>
                                  <p className="font-medium">{formatTimestamp(selectedJob.updatedAt)}</p>
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        </div>
                      )}
                    </section>

                    <Card className="flex min-h-0 flex-1 flex-col border-border/70">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2"><TerminalSquare className="h-4 w-4" /> Run History</CardTitle>
                        <CardDescription>Inspect manual and scheduled executions, including assistant output and session handoff.</CardDescription>
                      </CardHeader>
                      <CardContent className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-rows-1 grid-rows-[minmax(0,220px)_minmax(0,1fr)]">
                        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                          {runsLoading ? (
                            <div className="flex items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                          ) : runs?.length ? runs.map((run) => (
                            <button
                              key={run.id}
                              type="button"
                              onClick={() => setSelectedRunId(run.id)}
                              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${selectedRunId === run.id ? 'border-primary/30 bg-accent' : 'border-border/70 bg-background/60 hover:bg-accent/40'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge className={getRunTone(run)}>{run.status}</Badge>
                                <span className="text-xs text-muted-foreground">{run.triggerSource}</span>
                              </div>
                              <p className="mt-3 text-sm font-medium">{new Date(run.startedAt).toLocaleString()}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{run.sessionTitle ?? run.errorText ?? 'No session metadata recorded'}</p>
                            </button>
                          )) : (
                            <Alert>
                              <History className="h-4 w-4" />
                              <AlertTitle>No runs yet</AlertTitle>
                              <AlertDescription>Use Run now to generate the first execution record and log bundle.</AlertDescription>
                            </Alert>
                          )}
                        </div>

                        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background/60 p-4">
                          {activeRun ? (
                            <Tabs key={activeRun.id} defaultValue={activeRun.responseText ? 'response' : activeRun.errorText ? 'error' : 'log'} className="flex min-h-0 flex-1 flex-col">
                              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <Badge className={getRunTone(activeRun)}>{activeRun.status}</Badge>
                                    <span className="text-sm text-muted-foreground">{activeRun.triggerSource}</span>
                                  </div>
                                  <p className="mt-2 text-sm font-medium">Started {formatTimestamp(activeRun.startedAt)}</p>
                                  {activeRun.finishedAt && <p className="text-xs text-muted-foreground">Finished {formatTimestamp(activeRun.finishedAt)}</p>}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {activeRun.status === 'running' && (
                                    <Button variant="outline" size="sm" onClick={handleCancelRun} disabled={cancelRunMutation.isPending}>
                                      {cancelRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                                      Cancel run
                                    </Button>
                                  )}
                                  {activeRun.sessionId && (
                                    <Button variant="outline" size="sm" onClick={() => navigate(`/repos/${repoId}/sessions/${activeRun.sessionId}`)}>
                                      Open session
                                    </Button>
                                  )}
                                </div>
                              </div>

                              <TabsList>
                                <TabsTrigger value="log">Log</TabsTrigger>
                                <TabsTrigger value="response" disabled={!activeRun.responseText}>Assistant Output</TabsTrigger>
                                <TabsTrigger value="error" disabled={!activeRun.errorText}>{activeRun.status === 'cancelled' ? 'Details' : 'Error'}</TabsTrigger>
                              </TabsList>

                              <TabsContent value="log" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.logText ?? 'No log text captured.'}</pre>
                              </TabsContent>
                              <TabsContent value="response" className="mt-4 min-h-0 flex-1 overflow-hidden">
                                {activeRun.responseText ? (
                                  <Tabs defaultValue="preview" className="flex min-h-0 h-full flex-1 flex-col overflow-hidden">
                                    <TabsList>
                                      <TabsTrigger value="preview">Preview</TabsTrigger>
                                      <TabsTrigger value="markdown">Markdown</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="preview" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                      <ScheduleRunMarkdown content={activeRun.responseText} />
                                    </TabsContent>
                                    <TabsContent value="markdown" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                      <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">{activeRun.responseText}</pre>
                                    </TabsContent>
                                  </Tabs>
                                ) : (
                                  <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-6">No assistant output captured.</pre>
                                )}
                              </TabsContent>
                              <TabsContent value="error" className="mt-4 min-h-0 flex-1 overflow-y-auto">
                                <pre className={`whitespace-pre-wrap break-words text-sm font-mono leading-6 ${activeRun.status === 'cancelled' ? 'text-muted-foreground' : 'text-red-300'}`}>{activeRun.errorText ?? 'No error recorded.'}</pre>
                              </TabsContent>
                            </Tabs>
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a run to inspect logs and output.</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="border-dashed border-border/70">
                    <CardContent className="p-10 text-center">
                      <CalendarClock className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                      <p className="text-lg font-medium">No schedule selected</p>
                      <p className="mt-2 text-sm text-muted-foreground">Choose a job from the list or create a new one to configure agent automation for this repo.</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ScheduleJobDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingJob(undefined)
          }
        }}
        job={editingJob}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={editingJob ? handleUpdate : handleCreate}
      />

      <DeleteDialog
        open={deleteJobId !== null}
        onOpenChange={(open) => !open && setDeleteJobId(null)}
        onConfirm={handleDelete}
        onCancel={() => setDeleteJobId(null)}
        title="Delete Schedule"
        description="This removes the job definition and all recorded run history for it."
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
