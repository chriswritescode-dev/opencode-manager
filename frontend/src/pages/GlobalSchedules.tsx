import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllSchedules } from '@/hooks/useSchedules'
import { useDeleteRepoSchedule, useRunRepoSchedule, useUpdateRepoSchedule, useCreateRepoSchedule } from '@/hooks/useSchedules'
import { ScheduleJobDialog } from '@/components/schedules'
import type { CreateScheduleJobRequest } from '@opencode-manager/shared/types'
import { toUpdateScheduleRequest, formatScheduleShortLabel, getJobStatusTone, formatTimestamp } from '@/components/schedules/schedule-utils'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { CalendarClock, Loader2, Plus, ArrowLeft, Play, Pencil, Trash2, Pause, PlayCircle, Clock3, History, SlidersHorizontal } from 'lucide-react'

import type { ScheduleJobWithRepo } from '@/api/schedules'
import { Combobox } from '@/components/ui/combobox'

type StatusFilter = 'all' | 'enabled' | 'disabled'
type ScheduleModeFilter = 'all' | 'cron' | 'interval'
type SortOption = 'nextRun' | 'name' | 'repo'

export function GlobalSchedules() {
  const navigate = useNavigate()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduleJobWithRepo | null>(null)
  const [deletingJob, setDeletingJob] = useState<ScheduleJobWithRepo | null>(null)
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scheduleModeFilter, setScheduleModeFilter] = useState<ScheduleModeFilter>('all')
  const [repoFilter, setRepoFilter] = useState<string>('all')
  const [sortOption, setSortOption] = useState<SortOption>('nextRun')

  const { data: jobs = [], isLoading, error } = useAllSchedules()

  const createMutation = useCreateRepoSchedule(undefined)
  const deleteMutation = useDeleteRepoSchedule(undefined)
  const runMutation = useRunRepoSchedule(undefined)
  const updateMutation = useUpdateRepoSchedule(undefined)

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

  const stats = useMemo(() => {
    const total = jobs.length
    const enabled = jobs.filter((j) => j.enabled).length
    const disabled = total - enabled
    const now = Date.now()
    const last24h = now - 24 * 60 * 60 * 1000
    const recentRuns = jobs.filter((j) => j.lastRunAt && j.lastRunAt > last24h)

    return { total, enabled, disabled, recentRuns: recentRuns.length }
  }, [jobs])

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

  const handleDelete = () => {
    if (!deletingJob) {
      return
    }

    deleteMutation.mutate(
      { repoId: deletingJob.repoId, jobId: deletingJob.id },
      { onSuccess: () => setDeletingJob(null) }
    )
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
    setEditingJob(job)
    setDialogOpen(true)
  }

  const handleCreate = (data: CreateScheduleJobRequest) => {
    if (!selectedRepoId) return
    createMutation.mutate(
      { repoId: selectedRepoId, data },
      {
        onSuccess: () => {
          setDialogOpen(false)
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
          setDialogOpen(false)
          setEditingJob(null)
        },
      }
    )
  }

  const handleNavigateToRepo = (repoPath: string) => {
    const repoId = jobs.find((j) => j.repoPath === repoPath)?.repoId
    if (repoId) {
      navigate(`/repos/${repoId}`)
    }
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

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to="/" />
        <Header.Title>Schedules</Header.Title>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex h-6 rounded-full px-2 text-xs">
            {stats.total} total
          </Badge>
          <Badge variant="outline" className="h-6 rounded-full px-2 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
            {stats.enabled} enabled
          </Badge>
          <Header.Actions>
            <Button
              onClick={() => { setEditingJob(null); setSelectedRepoId(undefined); setDialogOpen(true) }}
              size="sm"
              className="hidden sm:flex"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Schedule
            </Button>
            <Button
              onClick={() => { setEditingJob(null); setSelectedRepoId(undefined); setDialogOpen(true) }}
              size="sm"
              className="sm:hidden"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </Header.Actions>
        </div>
      </Header>

      <div className="border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">Filter by repo:</span>
          <Combobox
            value={repoFilter}
            onChange={setRepoFilter}
            options={repoOptions}
            placeholder="All Repos"
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
        </div>
        <div className="hidden sm:flex flex-wrap gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Status:</span>
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
            <span className="text-xs text-muted-foreground whitespace-nowrap">Mode:</span>
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
            <span className="text-xs text-muted-foreground whitespace-nowrap">Sort:</span>
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

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
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
                    Try adjusting your filters to see more results.
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
                  Clear Filters
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
                        {job.description || 'No description'}
                      </p>
                    </div>
                    <Badge className={getJobStatusTone(job)}>
                      {job.enabled ? 'Enabled' : 'Paused'}
                    </Badge>
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
                        Next: {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'Never'}
                      </span>
                    </div>
                    {job.lastRunAt && (
                      <div className="flex items-center gap-2">
                        <History className="h-3.5 w-3.5" />
                        <span>
                          Last: {formatTimestamp(job.lastRunAt)}
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
                      Run
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
                        setDeletingJob(job)
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

      <ScheduleJobDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingJob(null)
            setSelectedRepoId(undefined)
          }
        }}
        job={editingJob ?? undefined}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onSubmit={editingJob ? handleUpdate : handleCreate}
        showRepoSelector
        repoId={selectedRepoId}
        onRepoChange={setSelectedRepoId}
      />

      <DeleteDialog
        open={deletingJob !== null}
        onOpenChange={(open) => !open && setDeletingJob(null)}
        onConfirm={handleDelete}
        onCancel={() => setDeletingJob(null)}
        title="Delete Schedule"
        description="This removes the job definition and all recorded run history for it."
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
