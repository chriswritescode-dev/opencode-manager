import { useTranslation } from 'react-i18next'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllSchedules, useAllScheduleRuns, useCancelRepoScheduleRun } from '@/hooks/useSchedules'
import { useDeleteRepoSchedule, useRunRepoSchedule, useUpdateRepoSchedule, useCreateRepoSchedule } from '@/hooks/useSchedules'
import { ScheduleJobDialog, RunHistoryCards, PromptsTab } from '@/components/schedules'
import type { CreateScheduleJobRequest } from '@opencode-manager/shared/types'
import { toUpdateScheduleRequest, formatScheduleShortLabel, formatTimestamp, getJobStatusTone } from '@/components/schedules/schedule-utils'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CalendarClock, Loader2, Plus, ArrowLeft, Play, Pencil, Trash2, Pause, PlayCircle, Clock3, History, SlidersHorizontal } from 'lucide-react'

import { useScheduleUrlState } from '@/hooks/useScheduleUrlState'
import type { ScheduleTab } from '@/hooks/useScheduleUrlState'

import type { ScheduleJobWithRepo, ScheduleRunWithContext } from '@/api/schedules'
import { Combobox } from '@/components/ui/combobox'
import { isAssistantRepoId } from '@/lib/schedules/schedule-target'
import { getAssistantPath } from '@/lib/navigation'

type StatusFilter = 'all' | 'enabled' | 'disabled'
type ScheduleModeFilter = 'all' | 'cron' | 'interval'
type SortOption = 'nextRun' | 'name' | 'repo'

export function GlobalSchedules() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scheduleModeFilter, setScheduleModeFilter] = useState<ScheduleModeFilter>('all')
  const [repoFilter, setRepoFilter] = useState<string>('all')
  const [sortOption, setSortOption] = useState<SortOption>('nextRun')
  const [runStatusFilter, setRunStatusFilter] = useState<string>('all')
  const [runRepoFilter, setRunRepoFilter] = useState<string>('all')
  const [runTriggerFilter, setRunTriggerFilter] = useState<string>('all')
  const [runSortOption, setRunSortOption] = useState<'startedAt' | 'jobName' | 'duration'>('startedAt')
  const [runOffset, setRunOffset] = useState(0)
  const [allRuns, setAllRuns] = useState<ScheduleRunWithContext[]>([])
  const runOffsetRef = useRef(runOffset)

  const { scheduleTab, setScheduleTab, dialog, promptDialog, jobId, runId, templateId, openNewJob, openEditJob, openDeleteJob, openNewTemplate, openEditTemplate, openDeleteTemplate, openImportTemplate, closeDialog, closePromptDialog, selectRun } = useScheduleUrlState()

  const cancelRunMutation = useCancelRepoScheduleRun()
  const cancelRunPending = cancelRunMutation.isPending

  useEffect(() => {
    runOffsetRef.current = runOffset
  }, [runOffset])

  const { data: jobs = [], isLoading, error } = useAllSchedules()

  const editingJob = useMemo(() => dialog === 'edit' ? (jobs.find(j => j.id === jobId) ?? null) : null, [dialog, jobId, jobs])
  const deletingJob = useMemo(() => dialog === 'delete' ? (jobs.find(j => j.id === jobId) ?? null) : null, [dialog, jobId, jobs])

  const runsParams = useMemo(() => ({
    limit: 50,
    offset: runOffset,
    status: runStatusFilter !== 'all' ? runStatusFilter : undefined,
    repoId: runRepoFilter !== 'all' ? Number(runRepoFilter.split('|')[0]) : undefined,
    triggerSource: runTriggerFilter !== 'all' ? runTriggerFilter : undefined,
  }), [runStatusFilter, runRepoFilter, runTriggerFilter, runOffset])

  const { data: runsPage = [], isLoading: runsLoading } = useAllScheduleRuns(runsParams, scheduleTab === 'runs')

  const createMutation = useCreateRepoSchedule()
  const deleteMutation = useDeleteRepoSchedule()
  const runMutation = useRunRepoSchedule()
  const updateMutation = useUpdateRepoSchedule()

  useEffect(() => {
    setRunOffset(0)
    setAllRuns([])
  }, [runStatusFilter, runRepoFilter, runTriggerFilter])

  useEffect(() => {
    if (runsPage.length > 0) {
      if (runOffsetRef.current === 0) {
        setAllRuns(runsPage)
      } else {
        setAllRuns((prev) => {
          const existingIds = new Set(prev.map((r) => r.id))
          const newRuns = runsPage.filter((r) => !existingIds.has(r.id))
          return newRuns.length > 0 ? [...prev, ...newRuns] : prev
        })
      }
    } else if (runOffsetRef.current === 0) {
      setAllRuns((prev) => prev.length > 0 ? [] : prev)
    }
  }, [runsPage])

  const sortedRuns = useMemo(() => {
    const sorted = [...allRuns]
    sorted.sort((a, b) => {
      switch (runSortOption) {
        case 'jobName':
          return a.jobName.localeCompare(b.jobName)
        case 'duration': {
          const aDuration = a.finishedAt ? a.finishedAt - a.startedAt : 0
          const bDuration = b.finishedAt ? b.finishedAt - b.startedAt : 0
          return bDuration - aDuration
        }
        case 'startedAt':
        default:
          return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      }
    })
    return sorted
  }, [allRuns, runSortOption])

  const uniqueRepos = useMemo(() => {
    const repoMap = new Map<string, { name: string; url: string }>()
    jobs.forEach((job) => {
      repoMap.set(job.repoPath, { name: job.repoName, url: job.repoUrl })
    })
    return Array.from(repoMap.entries()).map(([path, info]) => ({
      path,
      name: info.name,
      url: info.url,
    }))
  }, [jobs])

  const filteredAndSortedJobs = useMemo(() => {
    let filtered = [...jobs]

    if (statusFilter !== 'all') {
      filtered = filtered.filter((job) =>
        statusFilter === 'enabled' ? job.enabled : !job.enabled
      )
    }

    if (scheduleModeFilter !== 'all') {
      filtered = filtered.filter((job) =>
        scheduleModeFilter === 'cron' ? job.scheduleMode === 'cron' : job.scheduleMode === 'interval'
      )
    }

    if (repoFilter !== 'all') {
      filtered = filtered.filter((job) => job.repoPath === repoFilter)
    }

    filtered.sort((a, b) => {
      switch (sortOption) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'repo':
          return a.repoName.localeCompare(b.repoName) || a.name.localeCompare(b.name)
        case 'nextRun':
        default: {
          const aNext = a.nextRunAt ?? Infinity
          const bNext = b.nextRunAt ?? Infinity
          return aNext - bNext
        }
      }
    })

    return filtered
  }, [jobs, statusFilter, scheduleModeFilter, repoFilter, sortOption])

  const repoOptions = useMemo(() => [
    { value: 'all', label: t('schedule.allRepos'), description: `${jobs.length} ${t('schedule.totalJobs')}` },
    ...uniqueRepos.map((repo) => ({
      value: repo.path,
      label: repo.name,
      description: `${jobs.filter((j) => j.repoPath === repo.path).length} ${t('schedule.jobs')}`,
    })),
  ], [jobs, uniqueRepos, t])

  const statusOptions = useMemo(() => [
    { value: 'all', label: t('schedule.allStatus') },
    { value: 'enabled', label: t('schedule.enabled') },
    { value: 'disabled', label: t('common.disabled') },
  ], [t])

  const modeOptions = useMemo(() => [
    { value: 'all', label: t('schedule.allModes') },
    { value: 'cron', label: t('schedule.cron') },
    { value: 'interval', label: t('schedule.interval') },
  ], [t])

  const sortOptions = useMemo(() => [
    { value: 'nextRun', label: t('schedule.nextRun') },
    { value: 'name', label: t('common.name') },
    { value: 'repo', label: t('schedule.repo') },
  ], [t])

  const runStatusOptions = useMemo(() => [
    { value: 'all', label: t('schedule.allStatus') },
    { value: 'running', label: t('schedule.running') },
    { value: 'completed', label: t('schedule.completed') },
    { value: 'failed', label: t('schedule.failed') },
    { value: 'cancelled', label: t('schedule.cancelled') },
  ], [t])

  const runTriggerOptions = useMemo(() => [
    { value: 'all', label: t('schedule.allTriggers') },
    { value: 'manual', label: t('schedule.manual') },
    { value: 'schedule', label: t('schedule.scheduled') },
  ], [t])

  const runSortOptions = useMemo(() => [
    { value: 'startedAt', label: t('schedule.date') },
    { value: 'jobName', label: t('schedule.jobName') },
    { value: 'duration', label: t('schedule.duration') },
  ], [t])

  const runRepoOptions = useMemo(() => [
    { value: 'all', label: t('schedule.allRepos'), description: '' },
    ...uniqueRepos.map((repo) => ({
      value: `${jobs.find((j) => j.repoPath === repo.path)?.repoId ?? 0}|${repo.path}`,
      label: repo.name,
      description: repo.path,
    })),
  ], [uniqueRepos, jobs, t])

  const handleDelete = () => {
    if (!deletingJob) {
      return
    }

    deleteMutation.mutate(
      { repoId: deletingJob.repoId, jobId: deletingJob.id },
      { onSuccess: () => closeDialog() }
    )
  }

  const handleCancelRun = (repoId: number, jobId: number, runId: number) => {
    cancelRunMutation.mutate({ repoId, jobId, runId })
  }

  const handleToggleEnabled = (job: ScheduleJobWithRepo) => {
    updateMutation.mutate({
      repoId: job.repoId,
      jobId: job.id,
      data: { enabled: !job.enabled },
    })
  }

  const handleRunNow = (job: ScheduleJobWithRepo) => {
    runMutation.mutate({ repoId: job.repoId, jobId: job.id })
  }

  const handleEdit = (job: ScheduleJobWithRepo) => {
    openEditJob(job.id)
  }

  const handleCreate = (data: CreateScheduleJobRequest) => {
    if (selectedRepoId === undefined) return
    createMutation.mutate(
      { repoId: selectedRepoId, data },
      {
        onSuccess: () => {
          closeDialog()
          setSelectedRepoId(undefined)
        },
      }
    )
  }

  const handleUpdate = (data: CreateScheduleJobRequest) => {
    if (!editingJob) return
    updateMutation.mutate(
      {
        repoId: editingJob.repoId,
        jobId: editingJob.id,
        data: toUpdateScheduleRequest(data),
      },
      {
        onSuccess: () => {
          closeDialog()
        },
      }
    )
  }

  const handleNavigateToRepo = (repoPath: string) => {
    const repoId = jobs.find((j) => j.repoPath === repoPath)?.repoId
    if (repoId === undefined) return
    navigate(isAssistantRepoId(repoId) ? getAssistantPath() : `/repos/${repoId}`)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card>
          <CardContent className="p-6">
            <p className="text-destructive">{t('common.failed')}</p>
            <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('common.back')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const hasJobs = jobs.length > 0

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to="/" />
        <Header.Title>{t('schedule.title')}</Header.Title>
        <div className="flex items-center gap-2">
          <Header.Actions>
            <Button
              onClick={() => { openNewJob(); setSelectedRepoId(undefined) }}
              size="sm"
              className="hidden sm:flex"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('schedule.create')}
            </Button>
            <Button
              onClick={() => { openNewJob(); setSelectedRepoId(undefined) }}
              size="sm"
              className="sm:hidden h-10 w-10 p-0"
            >
              <Plus className="w-5 h-5" />
            </Button>
          </Header.Actions>
        </div>
      </Header>

      <Tabs value={scheduleTab} onValueChange={(v) => setScheduleTab(v as ScheduleTab)} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="border-b border-border px-4">
          <TabsList className="h-auto gap-0 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="jobs" className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              {t('schedule.jobs')}
            </TabsTrigger>
            <TabsTrigger value="runs" className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              {t('schedule.runHistory')}
            </TabsTrigger>
            <TabsTrigger value="prompts" className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              {t('schedule.prompts')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="jobs" className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-4 pt-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">{t('schedule.filterByRepo')}</span>
              <Combobox
                value={repoFilter}
                onChange={setRepoFilter}
                options={repoOptions}
                placeholder={t('schedule.allRepos')}
                className="flex-1 sm:flex-none sm:min-w-[150px]"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="sm:hidden h-8 w-8 shrink-0 relative">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {(statusFilter !== 'all' || scheduleModeFilter !== 'all') && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => {
                      setStatusFilter('all')
                      setScheduleModeFilter('all')
                      setRepoFilter('all')
                      setSortOption('nextRun')
                    }}
                    className="text-xs text-muted-foreground"
                  >
                    {t('schedule.clearAllFilters')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('schedule.statusLabel')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={statusFilter === 'all'}
                    onCheckedChange={() => setStatusFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t('schedule.allStatus')}
                  </DropdownMenuCheckboxItem>
                  {statusOptions.filter((opt) => opt.value !== 'all').map((opt) => (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={statusFilter === opt.value}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setStatusFilter(opt.value as StatusFilter)
                        } else {
                          setStatusFilter('all')
                        }
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('schedule.modeLabel')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={scheduleModeFilter === 'all'}
                    onCheckedChange={() => setScheduleModeFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t('schedule.allModes')}
                  </DropdownMenuCheckboxItem>
                  {modeOptions.filter((opt) => opt.value !== 'all').map((opt) => (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={scheduleModeFilter === opt.value}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setScheduleModeFilter(opt.value as ScheduleModeFilter)
                        } else {
                          setScheduleModeFilter('all')
                        }
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('schedule.sortBy')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                    {sortOptions.map((opt) => (
                      <DropdownMenuRadioItem
                        key={opt.value}
                        value={opt.value}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {opt.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="hidden sm:flex flex-wrap gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{t('schedule.statusLabel')}</span>
                <div className="flex gap-1">
                  {statusOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={statusFilter === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setStatusFilter(opt.value as StatusFilter)}
                      className="h-8 px-3 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{t('schedule.modeLabel')}</span>
                <div className="flex gap-1">
                  {modeOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={scheduleModeFilter === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setScheduleModeFilter(opt.value as ScheduleModeFilter)}
                      className="h-8 px-3 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{t('schedule.sortLabel')}</span>
                <div className="flex gap-1">
                  {sortOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={sortOption === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSortOption(opt.value as SortOption)}
                      className="h-8 px-3 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            {!hasJobs ? (
              <div className="flex min-h-full items-center justify-center">
                <Card className="max-w-md border-dashed border-border/70">
                  <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                    <div className="rounded-full border border-border bg-muted/40 p-4">
                      <CalendarClock className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-semibold">{t('schedule.noSchedules')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('schedule.emptyGlobal')}
                      </p>
                    </div>
                    <Button onClick={() => navigate('/')}>
                      <Plus className="w-4 h-4 mr-2" />
                      {t('schedule.goToRepos')}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : filteredAndSortedJobs.length === 0 ? (
              <div className="flex min-h-full items-center justify-center">
                <Card className="max-w-md border-dashed border-border/70">
                  <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                    <div className="rounded-full border border-border bg-muted/40 p-4">
                      <CalendarClock className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-semibold">{t('schedule.noMatching')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('schedule.noMatchingDesc')}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatusFilter('all')
                        setScheduleModeFilter('all')
                        setRepoFilter('all')
                      }}
                    >
                      {t('schedule.clearFilters')}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredAndSortedJobs.map((job) => (
                  <Card
                    key={job.id}
                    className="group cursor-pointer transition-all hover:shadow-md border-border/70 bg-card/60"
                    onClick={() => navigate(`/repos/${job.repoId}/schedules`)}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleNavigateToRepo(job.repoPath)
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline truncate block mb-1"
                          >
                            {job.repoName}
                          </button>
                          <h3 className="font-medium truncate">{job.name}</h3>
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {job.description || t('schedule.noDescription')}
                          </p>
                        </div>
                        <Badge className={getJobStatusTone(job)}>{job.enabled ? t('schedule.enabled') : t('schedule.paused')}</Badge>
                      </div>

                      <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span className="truncate">
                            {formatScheduleShortLabel(job)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-3.5 w-3.5" />
                          <span>
                            {t('schedule.nextRunLabel')} {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : t('schedule.nextRunNever')}
                          </span>
                        </div>
                        {job.lastRunAt && (
                          <div className="flex items-center gap-2">
                            <History className="h-3.5 w-3.5" />
                            <span>
                              {t('schedule.lastRunLabel')} {formatTimestamp(job.lastRunAt)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-border/50">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRunNow(job)
                          }}
                          disabled={runMutation.isPending}
                        >
                          <PlayCircle className="h-3.5 w-3.5 mr-1" />
                          {t('schedule.runNow')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleEnabled(job)
                          }}
                        >
                          {job.enabled ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleEdit(job)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              openDeleteJob(job.id)
                            }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="runs" className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-4 pt-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">{t('schedule.filterByRepo')}</span>
              <Combobox
                value={runRepoFilter}
                onChange={setRunRepoFilter}
                options={runRepoOptions}
                placeholder={t('schedule.allRepos')}
                className="flex-1 sm:flex-none sm:min-w-[150px]"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="sm:hidden h-8 w-8 shrink-0 relative">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {(runStatusFilter !== 'all' || runTriggerFilter !== 'all' || runSortOption !== 'startedAt') && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => {
                      setRunStatusFilter('all')
                      setRunTriggerFilter('all')
                      setRunRepoFilter('all')
                      setRunSortOption('startedAt')
                    }}
                    className="text-xs text-muted-foreground"
                  >
                    {t('schedule.clearAllFilters')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('schedule.statusLabel')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={runStatusFilter === 'all'}
                    onCheckedChange={() => setRunStatusFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t('schedule.allStatus')}
                  </DropdownMenuCheckboxItem>
                  {runStatusOptions.filter((opt) => opt.value !== 'all').map((opt) => (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={runStatusFilter === opt.value}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setRunStatusFilter(opt.value)
                        } else {
                          setRunStatusFilter('all')
                        }
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('schedule.triggerLabel')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={runTriggerFilter === 'all'}
                    onCheckedChange={() => setRunTriggerFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t('schedule.allTriggers')}
                  </DropdownMenuCheckboxItem>
                  {runTriggerOptions.filter((opt) => opt.value !== 'all').map((opt) => (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={runTriggerFilter === opt.value}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setRunTriggerFilter(opt.value)
                        } else {
                          setRunTriggerFilter('all')
                        }
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('schedule.sortBy')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={runSortOption} onValueChange={(v) => setRunSortOption(v as 'startedAt' | 'jobName' | 'duration')}>
                    {runSortOptions.map((opt) => (
                      <DropdownMenuRadioItem
                        key={opt.value}
                        value={opt.value}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {opt.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="hidden sm:flex flex-wrap gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{t('schedule.statusLabel')}</span>
                <div className="flex gap-1">
                  {runStatusOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={runStatusFilter === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setRunStatusFilter(opt.value)}
                      className="h-8 px-3 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{t('schedule.triggerLabel')}</span>
                <div className="flex gap-1">
                  {runTriggerOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={runTriggerFilter === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setRunTriggerFilter(opt.value)}
                      className="h-8 px-3 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{t('schedule.sortLabel')}</span>
                <div className="flex gap-1">
                  {runSortOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={runSortOption === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setRunSortOption(opt.value as 'startedAt' | 'jobName' | 'duration')}
                      className="h-8 px-3 text-xs"
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
            {runsLoading && allRuns.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : allRuns.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Card className="max-w-md border-dashed border-border/70">
                  <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                    <div className="rounded-full border border-border bg-muted/40 p-4">
                      <History className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-semibold">{t('schedule.noRuns')}</p>
                      <p className="text-sm text-muted-foreground">
                        {runStatusFilter !== 'all' || runRepoFilter !== 'all' || runTriggerFilter !== 'all'
                          ? t('schedule.noRunsDesc')
                          : t('schedule.noRunsEmptyDesc')}
                      </p>
                    </div>
                    {(runStatusFilter !== 'all' || runRepoFilter !== 'all' || runTriggerFilter !== 'all' || runSortOption !== 'startedAt') && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setRunStatusFilter('all')
                          setRunRepoFilter('all')
                          setRunTriggerFilter('all')
                          setRunSortOption('startedAt')
                        }}
                      >
                        {t('schedule.clearFilters')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <RunHistoryCards
                runs={sortedRuns}
                runsLoading={runsLoading}
                onSelectRun={selectRun}
                onCancelRun={() => {
                  if (runId) {
                    const run = sortedRuns.find((r) => r.id === runId)
                    if (run) {
                      handleCancelRun(run.repoId, run.jobId, run.id)
                    }
                  }
                }}
                cancelRunPending={cancelRunPending}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="prompts" className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-4">
            <PromptsTab
              promptDialog={promptDialog}
              templateId={templateId}
              onNew={openNewTemplate}
              onEdit={openEditTemplate}
              onDelete={openDeleteTemplate}
              onImport={openImportTemplate}
              onCloseDialog={closePromptDialog}
            />
          </div>
        </TabsContent>
      </Tabs>

      <ScheduleJobDialog
        open={dialog === 'new' || dialog === 'edit'}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog()
            setSelectedRepoId(undefined)
          }
        }}
        job={dialog === 'edit' ? (editingJob ?? undefined) : undefined}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={dialog === 'edit' ? handleUpdate : handleCreate}
        showRepoSelector
        repoId={selectedRepoId}
        onRepoChange={setSelectedRepoId}
      />

      <DeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && closeDialog()}
        onConfirm={handleDelete}
        onCancel={closeDialog}
        title={t('schedule.deleteTitle')}
        description={t('schedule.deleteDescription')}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
