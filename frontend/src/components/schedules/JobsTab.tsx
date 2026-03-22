import type { ScheduleJob } from '@opencode-manager/shared/types'
import { Badge } from '@/components/ui/badge'
import { formatScheduleShortLabel, getJobStatusTone } from '@/components/schedules/schedule-utils'
import { Bot, Clock3 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface JobsTabProps {
  jobs: ScheduleJob[]
  selectedJobId: number | null
  onSelectJob: (id: number) => void
}

export function JobsTab({ jobs, selectedJobId, onSelectJob }: JobsTabProps) {
  return (
    <div className="h-full overflow-y-auto space-y-2 py-2">
      {jobs.map((job) => (
        <button
          key={job.id}
          type="button"
          onClick={() => onSelectJob(job.id)}
          className={cn(
            'w-full rounded-xl border-2 px-4 py-3 text-left transition-all',
            selectedJobId === job.id
              ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
              : 'border-border/70 bg-background/60 hover:bg-accent/40'
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{job.name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{job.description || 'No description yet'}</p>
            </div>
            <Badge className={getJobStatusTone(job)}>{job.enabled ? 'Enabled' : 'Paused'}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatScheduleShortLabel(job)}</span>
            <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> {job.agentSlug ?? 'default agent'}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
