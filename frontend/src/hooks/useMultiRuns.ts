import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { discardMultiRunEntry, fuseMultiRun, launchMultiRun, listMultiRuns } from '@/api/multiRuns'
import { repoSiblingsQueryKey } from '@/hooks/useRepoSiblings'
import { showToast } from '@/lib/toast'
import type {
  FuseMultiRunRequest,
  LaunchMultiRunRequest,
  MultiRun,
  MultiRunFusion,
} from '@opencode-manager/shared/schemas'

function multiRunQueryKey(repoId: number) {
  return ['multi-runs', repoId] as const
}

function invalidateMultiRunCaches(queryClient: QueryClient, repoId: number) {
  queryClient.invalidateQueries({ queryKey: multiRunQueryKey(repoId) })
  queryClient.invalidateQueries({ queryKey: repoSiblingsQueryKey(repoId) })
}

function buildStartingFusion(run: MultiRun, request: FuseMultiRunRequest): MultiRunFusion {
  const now = Date.now()
  const entriesById = new Map(run.entries.map((entry) => [entry.id, entry]))
  return {
    id: -now,
    requestId: request.requestId,
    model: request.model,
    instructions: request.instructions ?? null,
    isolated: request.isolate,
    baseRef: request.baseRef ?? null,
    status: 'starting',
    sessionId: null,
    directory: null,
    error: null,
    sources: request.entryIds.flatMap((entryId) => {
      const entry = entriesById.get(entryId)
      return entry?.sessionId ? [{ entryId, sessionId: entry.sessionId, model: entry.model, truncated: false }] : []
    }),
    createdAt: now,
    updatedAt: now,
  }
}

function countEntries(run: MultiRun, status: MultiRun['entries'][number]['status']) {
  return run.entries.filter((entry) => entry.status === status).length
}

export function useMultiRuns(repoId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: multiRunQueryKey(repoId ?? 0),
    queryFn: () => listMultiRuns(repoId!),
    enabled: enabled && !!repoId && repoId > 0,
    staleTime: 10_000,
  })
}

export function useLaunchMultiRun(repoId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: LaunchMultiRunRequest) => launchMultiRun(request),
    onSuccess: (run) => {
      invalidateMultiRunCaches(queryClient, repoId)
      const started = countEntries(run, 'started')
      const failed = countEntries(run, 'failed')
      if (failed === 0) {
        showToast.success(`Started ${started} run${started === 1 ? '' : 's'}`)
      } else if (started === 0) {
        showToast.error(`Failed to start ${failed} run${failed === 1 ? '' : 's'}`)
      } else {
        showToast.warning(`Started ${started}, failed ${failed}`)
      }
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to launch multi-run')
    },
  })
}

export function useFuseMultiRun(repoId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ runId, request }: { runId: number; request: FuseMultiRunRequest }) =>
      fuseMultiRun(runId, request),
    onMutate: async ({ runId, request }) => {
      const queryKey = multiRunQueryKey(repoId)
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<MultiRun[]>(queryKey, (runs) =>
        runs?.map((run) =>
          run.id === runId && !run.fusions.some((fusion) => fusion.requestId === request.requestId)
            ? { ...run, fusions: [...run.fusions, buildStartingFusion(run, request)] }
            : run,
        ),
      )
    },
    onSuccess: (run, variables) => {
      queryClient.setQueryData<MultiRun[]>(multiRunQueryKey(repoId), (runs) =>
        runs?.map((candidate) => (candidate.id === run.id ? run : candidate)),
      )
      invalidateMultiRunCaches(queryClient, repoId)
      const fusion = run.fusions.find((candidate) => candidate.requestId === variables.request.requestId)
      if (fusion?.status === 'started') {
        showToast.success('Fusion started')
      } else if (fusion?.status === 'failed') {
        showToast.error(fusion.error || 'Fusion failed')
      }
    },
    onError: () => {
      invalidateMultiRunCaches(queryClient, repoId)
    },
  })
}

export function useDiscardMultiRunEntry(repoId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ runId, entryId }: { runId: number; entryId: number }) =>
      discardMultiRunEntry(runId, entryId),
    onSuccess: () => {
      invalidateMultiRunCaches(queryClient, repoId)
      showToast.success('Run discarded')
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to discard run')
    },
  })
}
