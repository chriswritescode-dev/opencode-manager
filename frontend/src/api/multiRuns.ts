import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { z } from 'zod'
import { MultiRunSchema } from '@opencode-manager/shared/schemas'
import type {
  FuseMultiRunRequest,
  LaunchMultiRunRequest,
  MultiRun,
  MultiRunTarget,
} from '@opencode-manager/shared/schemas'

const multiRunsResponseSchema = z.object({ runs: z.array(MultiRunSchema) })
const multiRunResponseSchema = z.object({ run: MultiRunSchema })

function targetParams(target: MultiRunTarget): Record<string, string | number> {
  return target.kind === 'repo'
    ? { repoId: target.repoId }
    : { serverId: target.serverId, directory: target.directory }
}

export async function listMultiRuns(target: MultiRunTarget): Promise<MultiRun[]> {
  const res = await fetchWrapper(`${API_BASE_URL}/api/multi-runs`, multiRunsResponseSchema, {
    params: targetParams(target),
  })
  return res.runs
}

export async function launchMultiRun(request: LaunchMultiRunRequest): Promise<MultiRun> {
  const res = await fetchWrapper(`${API_BASE_URL}/api/multi-runs`, multiRunResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return res.run
}

export async function fuseMultiRun(runId: number, request: FuseMultiRunRequest): Promise<MultiRun> {
  const res = await fetchWrapper(
    `${API_BASE_URL}/api/multi-runs/${encodeURIComponent(runId)}/fusions`,
    multiRunResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  )
  return res.run
}

export async function discardMultiRunEntry(runId: number, entryId: number): Promise<MultiRun> {
  const res = await fetchWrapper(
    `${API_BASE_URL}/api/multi-runs/${encodeURIComponent(runId)}/entries/${encodeURIComponent(entryId)}/discard`,
    multiRunResponseSchema,
    { method: 'POST' },
  )
  return res.run
}
