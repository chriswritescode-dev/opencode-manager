import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useAssistantMode } from '@/hooks/useAssistantMode'
import { isAssistantRepoId, scheduleTargetFromAssistant, scheduleTargetFromRepo } from '@/lib/schedules/schedule-target'
import type { ScheduleTarget } from '@/lib/schedules/schedule-target'

interface ScheduleTargetState {
  scheduleTarget: ScheduleTarget | undefined
  isLoading: boolean
  isError: boolean
}

export function useScheduleTarget(repoId: number | undefined): ScheduleTargetState {
  const assistantQuery = useAssistantMode(repoId)

  const repoQuery = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined && repoId > 0,
  })

  if (isAssistantRepoId(repoId)) {
    return {
      scheduleTarget: assistantQuery.status ? scheduleTargetFromAssistant(assistantQuery.status) : undefined,
      isLoading: assistantQuery.isLoading,
      isError: assistantQuery.isError,
    }
  }

  return {
    scheduleTarget: repoQuery.data ? scheduleTargetFromRepo(repoQuery.data) : undefined,
    isLoading: repoQuery.isLoading,
    isError: repoQuery.isError,
  }
}
