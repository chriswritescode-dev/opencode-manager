import { useLocation, useParams } from 'react-router-dom'
import { useRepoActivity } from '@/hooks/useRepoActivity'
import { useScheduleTarget } from '@/hooks/useScheduleTarget'
import { useScheduleUrlState } from '@/hooks/useScheduleUrlState'
import { ScheduleRepoSwitcher } from '@/components/schedules'
import { RepoSchedulesContent } from '@/components/schedules/RepoSchedulesContent'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { getReturnToPath } from '@/lib/navigation'
import { Loader2, Plus } from 'lucide-react'

export function Schedules() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const repoId = id ? Number(id) : undefined
  const { openNewJob } = useScheduleUrlState()

  const { scheduleTarget, isLoading: scheduleTargetLoading } = useScheduleTarget(repoId)

  useRepoActivity(repoId ?? 0, Boolean(scheduleTarget) && scheduleTarget?.kind === 'repo')

  if (scheduleTargetLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!scheduleTarget || repoId === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">
          {repoId === 0 ? 'Assistant not found' : 'Repository not found'}
        </p>
      </div>
    )
  }

  const backHref = getReturnToPath(location.search, scheduleTarget.backHref)

  return (
    <div className="h-full max-h-full overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.BackButton to={backHref} />
        <div className="min-w-0 flex-1 px-3">
          <ScheduleRepoSwitcher repoId={repoId} name={scheduleTarget.name} />
          <p className="text-xs text-muted-foreground truncate">{scheduleTarget.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Header.Actions>
            <Button onClick={openNewJob} size="sm" className="hidden sm:flex">
              <Plus className="w-4 h-4 mr-2" />
              New Schedule
            </Button>
            <Button onClick={openNewJob} size="sm" className="sm:hidden h-10 w-10 p-0">
              <Plus className="w-5 h-5" />
            </Button>
          </Header.Actions>
        </div>
      </Header>

      <RepoSchedulesContent repoId={repoId} embedded={false} />
    </div>
  )
}
