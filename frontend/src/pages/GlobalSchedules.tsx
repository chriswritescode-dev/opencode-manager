import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllSchedules, useAllScheduleRuns, useCancelRepoScheduleRun, useUnreadScheduleRuns } from '@/hooks/useSchedules'
import { useDeleteRepoSchedule, useRunRepoSchedule, useUpdateRepoSchedule, useCreateRepoSchedule } from '@/hooks/useSchedules'
import { ScheduleJobDialog, PromptsTab, ScheduleJobsTable, ScheduleListToolbar, ScheduleRunDrawer, ScheduleRunsTable, ScheduleRepoSwitcher } from '@/components/schedules'
import type { CreateScheduleJobRequest } from '@opencode-manager/shared/types'
import { DELETE_SCHEDULE_DESCRIPTION, matchesScheduleJobSearch, toUpdateScheduleRequest } from '@/components/schedules/schedule-utils'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { ScheduleReportsBell } from '@/components/notifications/ScheduleReportsBell'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CalendarClock, Loader2, Plus, ArrowLeft, SlidersHorizontal } from 'lucide-react'

import { useScheduleUrlState } from '@/hooks/useScheduleUrlState'
import type { ScheduleTab } from '@/hooks/useScheduleUrlState'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

import type { ScheduleJobWithRepo, ScheduleRunWithContext } from '@/api/schedules'
import { Combobox } from '@/components/ui/combobox'
import { getRepoPath } from '@/lib/navigation'

type StatusFilter = 'all' | 'enabled' | 'disabled'
type ScheduleModeFilter = 'all' | 'cron' | 'interval'
type SortOption = 'nextRun' | 'name' | 'repo'

export function GlobalSchedules() {
  const navigate = useNavigate()
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scheduleModeFilter, setScheduleModeFilter] = useState<ScheduleModeFilter>('all')
  const [repoFilter, setRepoFilter] = useState<string>('all')
  const [sortOption, setSortOption] = useState<SortOption>('nextRun')
  const [searchQuery, setSearchQuery] = useState('')
  const [runSearch, setRunSearch] = useState('')
  const debouncedRunSearch = useDebouncedValue(runSearch.trim(), 300)
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
    search: debouncedRunSearch || undefined,
  }), [runStatusFilter, runRepoFilter, runTriggerFilter, runOffset, debouncedRunSearch])

  const { data: runsPage = [], isLoading: runsLoading } = useAllScheduleRuns(runsParams, scheduleTab === 'runs')

  const selectedRunInHistory = useMemo(
    () => (runId !== null ? allRuns.find((run) => run.id === runId) ?? null : null),
    [allRuns, runId],
  )

  const selectedRunParams = useMemo(() => ({ limit: 1, runId: runId ?? undefined }), [runId])

  const {
    data: selectedRunPage,
    isLoading: selectedRunLoading,
    isError: selectedRunError,
    refetch: refetchSelectedRun,
  } = useAllScheduleRuns(
    selectedRunParams,
    runId !== null && selectedRunInHistory === null,
  )

  const selectedRun = runId === null
    ? null
    : selectedRunInHistory ?? selectedRunPage?.[0] ?? null

  const { data: unreadRuns } = useUnreadScheduleRuns()
  const unreadTotal = unreadRuns?.total ?? 0
  const nextUnreadRun = unreadRuns?.runs.find((run) => run.id !== runId) ?? unreadRuns?.runs[0] ?? null

  const handleNextUnread = useCallback(() => {
    if (!nextUnreadRun) return
    selectRun(nextUnreadRun.id)
  }, [nextUnreadRun, selectRun])

  const createMutation = useCreateRepoSchedule()
  const deleteMutation = useDeleteRepoSchedule()
  const runMutation = useRunRepoSchedule()
  const updateMutation = useUpdateRepoSchedule()

  useEffect(() => {
    setRunOffset(0)
    setAllRuns([])
  }, [runStatusFilter, runRepoFilter, runTriggerFilter, debouncedRunSearch])

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

  const runsForDisplay = useMemo(() => {
    if (!selectedRun || allRuns.some((run) => run.id === selectedRun.id)) {
      return allRuns
    }
    return [...allRuns, selectedRun]
  }, [allRuns, selectedRun])

  const sortedRuns = useMemo(() => {
    const sorted = [...runsForDisplay]
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
  }, [runsForDisplay, runSortOption])

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

    filtered = filtered.filter((job) => matchesScheduleJobSearch(job, searchQuery))

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
  }, [jobs, statusFilter, scheduleModeFilter, repoFilter, sortOption, searchQuery])

  const repoOptions = useMemo(() => [
    { value: 'all', label: 'All Repos', description: `${jobs.length} total jobs` },
    ...uniqueRepos.map((repo) => ({
      value: repo.path,
      label: repo.name,
      description: `${jobs.filter((j) => j.repoPath === repo.path).length} jobs`,
    })),
  ], [jobs, uniqueRepos])

  const statusOptions = useMemo(() => [
    { value: 'all', label: 'All Status' },
    { value: 'enabled', label: 'Enabled' },
    { value: 'disabled', label: 'Disabled' },
  ], [])

  const modeOptions = useMemo(() => [
    { value: 'all', label: 'All Modes' },
    { value: 'cron', label: 'Cron' },
    { value: 'interval', label: 'Interval' },
  ], [])

  const sortOptions = useMemo(() => [
    { value: 'nextRun', label: 'Next Run' },
    { value: 'name', label: 'Name' },
    { value: 'repo', label: 'Repository' },
  ], [])

  const runStatusOptions = useMemo(() => [
    { value: 'all', label: 'All Status' },
    { value: 'running', label: 'Running' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ], [])

  const runTriggerOptions = useMemo(() => [
    { value: 'all', label: 'All Triggers' },
    { value: 'manual', label: 'Manual' },
    { value: 'schedule', label: 'Scheduled' },
  ], [])

  const runSortOptions = useMemo(() => [
    { value: 'startedAt', label: 'Date' },
    { value: 'jobName', label: 'Job Name' },
    { value: 'duration', label: 'Duration' },
  ], [])

  const runRepoOptions = useMemo(() => [
    { value: 'all', label: 'All Repos', description: '' },
    ...uniqueRepos.map((repo) => ({
      value: `${jobs.find((j) => j.repoPath === repo.path)?.repoId ?? 0}|${repo.path}`,
      label: repo.name,
      description: repo.path,
    })),
  ], [uniqueRepos, jobs])

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
    navigate(getRepoPath(repoId))
  }

  const handleOpenJobPage = (job: ScheduleJobWithRepo) => {
    navigate(`/repos/${job.repoId}/schedules`)
  }

  const handleOpenJobRow = (job: ScheduleJobWithRepo) => {
    const lastRun = job.lastRun
    if (lastRun) {
      selectRun(lastRun.id)
      return
    }
    handleOpenJobPage(job)
  }

  const handleCancelJobRun = (job: ScheduleJobWithRepo) => {
    if (!job.lastRun) return
    handleCancelRun(job.repoId, job.id, job.lastRun.id)
  }

  const handleCancelSelectedRun = () => {
    if (!selectedRun) return
    handleCancelRun(selectedRun.repoId, selectedRun.jobId, selectedRun.id)
  }

  const selectedRunIndex = runId !== null ? sortedRuns.findIndex((run) => run.id === runId) : -1
  const selectedRunPrev = scheduleTab === 'runs' && selectedRunIndex > 0
    ? () => selectRun(sortedRuns[selectedRunIndex - 1].id)
    : undefined
  const selectedRunNext = scheduleTab === 'runs' && selectedRunIndex >= 0 && selectedRunIndex < sortedRuns.length - 1
    ? () => selectRun(sortedRuns[selectedRunIndex + 1].id)
    : undefined

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
            <p className="text-destructive">Failed to load schedules</p>
            <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const hasJobs = jobs.length > 0

  const selectedRunMissing = runId !== null && selectedRunInHistory === null
  const selectedRunLookupLoading = selectedRunMissing && selectedRunLoading
  const selectedRunLookupError = selectedRunMissing && selectedRunError && selectedRun === null

  return (
    <div className="h-full max-h-full overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to="/" />
        <div className="min-w-0 flex-1 px-3">
          <ScheduleRepoSwitcher name="All repos" />
          <p className="text-xs text-muted-foreground truncate">Schedules</p>
        </div>
        <div className="flex items-center gap-2">
          <Header.Actions>
            <ScheduleReportsBell />
            <Button
              onClick={() => { openNewJob(); setSelectedRepoId(undefined) }}
              size="sm"
              className="hidden sm:flex"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Schedule
            </Button>
            <Button
              onClick={() => { openNewJob(); setSelectedRepoId(undefined) }}
              size="sm"
              aria-label="New Schedule"
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
              Jobs
            </TabsTrigger>
            <TabsTrigger value="runs" className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Run History
            </TabsTrigger>
            <TabsTrigger value="prompts" className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Prompts
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="jobs" className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-2 sm:px-4">
            <ScheduleListToolbar search={searchQuery} onSearchChange={setSearchQuery} searchPlaceholder="Search jobs">
              <Combobox
                value={repoFilter}
                onChange={setRepoFilter}
                options={repoOptions}
                placeholder="All Repos"
                className="w-[130px] shrink-0 sm:w-[180px]"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Filters" className="shrink-0 relative">
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
                      setSearchQuery('')
                    }}
                    className="text-xs text-muted-foreground"
                  >
                    Clear all filters
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={statusFilter === 'all'}
                    onCheckedChange={() => setStatusFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All Status
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
                  <DropdownMenuLabel>Mode</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={scheduleModeFilter === 'all'}
                    onCheckedChange={() => setScheduleModeFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All Modes
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
                  <DropdownMenuLabel>Sort</DropdownMenuLabel>
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
            </ScheduleListToolbar>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-2 sm:px-4 pt-2 pb-mobile-tabbar sm:pb-4">
            {!hasJobs ? (
              <div className="flex min-h-full items-center justify-center">
                <Card className="max-w-md border-dashed border-border/70">
                  <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                    <div className="rounded-full border border-border bg-muted/40 p-4">
                      <CalendarClock className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-semibold">No schedules yet</p>
                      <p className="text-sm text-muted-foreground">
                        Create schedules for your repositories to automate recurring agent work.
                      </p>
                    </div>
                    <Button onClick={() => navigate('/')}>
                      <Plus className="w-4 h-4 mr-2" />
                      Go to Repositories
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
                      <p className="text-lg font-semibold">No matching schedules</p>
                      <p className="text-sm text-muted-foreground">
                        Try a different search or adjust your filters.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatusFilter('all')
                        setScheduleModeFilter('all')
                        setRepoFilter('all')
                        setSearchQuery('')
                      }}
                    >
                      Clear Filters
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="min-h-0 overflow-auto rounded-lg border border-border/70">
                <ScheduleJobsTable
                  jobs={filteredAndSortedJobs}
                  showRepo
                  onOpen={handleOpenJobRow}
                  onOpenJob={handleOpenJobPage}
                  onNavigateToRepo={handleNavigateToRepo}
                  onRunNow={handleRunNow}
                  onToggleEnabled={handleToggleEnabled}
                  onEdit={handleEdit}
                  onDelete={(job) => openDeleteJob(job.id)}
                  onCancelRun={handleCancelJobRun}
                  runPending={runMutation.isPending}
                  cancelPending={cancelRunPending}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="runs" className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-2 sm:px-4">
            <ScheduleListToolbar search={runSearch} onSearchChange={setRunSearch} searchPlaceholder="Search runs">
              <Combobox
                value={runRepoFilter}
                onChange={setRunRepoFilter}
                options={runRepoOptions}
                placeholder="All Repos"
                className="w-[130px] shrink-0 sm:w-[180px]"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Filters" className="shrink-0 relative">
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
                      setRunSearch('')
                    }}
                    className="text-xs text-muted-foreground"
                  >
                    Clear all filters
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={runStatusFilter === 'all'}
                    onCheckedChange={() => setRunStatusFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All Status
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
                  <DropdownMenuLabel>Trigger</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={runTriggerFilter === 'all'}
                    onCheckedChange={() => setRunTriggerFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All Triggers
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
                  <DropdownMenuLabel>Sort</DropdownMenuLabel>
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
              {unreadTotal > 0 && (
                <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={handleNextUnread}>
                  Next unread ({unreadTotal})
                </Button>
              )}
            </ScheduleListToolbar>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-2 sm:px-4 pt-2 pb-mobile-tabbar sm:pb-4">
            <div className="min-h-0 overflow-auto rounded-lg border border-border/70">
              <ScheduleRunsTable
                runs={sortedRuns}
                runsLoading={runsLoading && allRuns.length === 0}
                selectedRunId={runId}
                onSelectRun={selectRun}
                isFiltered={Boolean(debouncedRunSearch) || runStatusFilter !== 'all' || runRepoFilter !== 'all' || runTriggerFilter !== 'all'}
              />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="prompts" className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto px-2 sm:px-4 pt-2 pb-mobile-tabbar sm:pb-4">
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

      <ScheduleRunDrawer
        run={selectedRun}
        open={runId !== null}
        onClose={() => selectRun(null)}
        onCancelRun={handleCancelSelectedRun}
        cancelPending={cancelRunPending}
        runLoading={selectedRunLookupLoading}
        runError={selectedRunLookupError}
        onRetry={() => { void refetchSelectedRun() }}
        onNextUnread={handleNextUnread}
        nextUnreadCount={unreadTotal}
        onPrev={selectedRunPrev}
        onNext={selectedRunNext}
      />

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
        title="Delete Schedule"
        description={DELETE_SCHEDULE_DESCRIPTION}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
