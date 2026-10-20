import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { discardMultiRunEntry, fuseMultiRun, launchMultiRun, listMultiRuns } from '@/api/multiRuns'
import { repoSiblingsQueryKey } from '@/hooks/useRepoSiblings'
import { showToast } from '@/lib/toast'
import type {
  FuseMultiRunRequest,
  LaunchMultiRunRequest,
  MultiRun,
  MultiRunFusion,
  MultiRunTarget,
} from '@opencode-manager/shared/schemas'

function multiRunQueryKey(target: MultiRunTarget | undefined) {
  return ['multi-runs', target] as const
}

function invalidateMultiRunCaches(queryClient: QueryClient, target: MultiRunTarget) {
  queryClient.invalidateQueries({ queryKey: multiRunQueryKey(target) })
  if (target.kind === 'repo') {
    queryClient.invalidateQueries({ queryKey: repoSiblingsQueryKey(target.repoId) })
  }
}

function buildStartingFusion(run: MultiRun, request: FuseMultiRunRequest): MultiRunFusion {
  const now = Date.now()
  const entriesById = new Map(run.entries.map((entry) => [entry.id, entry]))
  return {
    id: -now,
    requestId: request.requestId,
    model: request.model,
    instructions: request.instructions ?? null,
    isolated: true,
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

export function useMultiRuns(target: MultiRunTarget | undefined, enabled: boolean) {
  return useQuery({
    queryKey: multiRunQueryKey(target),
    queryFn: () => listMultiRuns(target!),
    enabled: enabled && target !== undefined,
    staleTime: 10_000,
  })
}

export function useLaunchMultiRun(target: MultiRunTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: LaunchMultiRunRequest) => launchMultiRun(request),
    onSuccess: (run) => {
      invalidateMultiRunCaches(queryClient, target)
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

export function useFuseMultiRun(target: MultiRunTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ runId, request }: { runId: number; request: FuseMultiRunRequest }) =>
      fuseMultiRun(runId, request),
    onMutate: async ({ runId, request }) => {
      const queryKey = multiRunQueryKey(target)
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
      queryClient.setQueryData<MultiRun[]>(multiRunQueryKey(target), (runs) =>
        runs?.map((candidate) => (candidate.id === run.id ? run : candidate)),
      )
      invalidateMultiRunCaches(queryClient, target)
      const fusion = run.fusions.find((candidate) => candidate.requestId === variables.request.requestId)
      if (fusion?.status === 'started') {
        showToast.success('Fusion started')
      } else if (fusion?.status === 'failed') {
        showToast.error(fusion.error || 'Fusion failed')
      }
    },
    onError: () => {
      invalidateMultiRunCaches(queryClient, target)
    },
  })
}

export function useDiscardMultiRunEntry(target: MultiRunTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ runId, entryId }: { runId: number; entryId: number }) =>
      discardMultiRunEntry(runId, entryId),
    onSuccess: () => {
      invalidateMultiRunCaches(queryClient, target)
      showToast.success('Run discarded')
    },
    onError: (error: unknown) => {
      showToast.error(error instanceof Error ? error.message : 'Failed to discard run')
    },
  })
}
