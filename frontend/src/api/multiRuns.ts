import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  FuseMultiRunRequest,
  LaunchMultiRunRequest,
  MultiRun,
  MultiRunTarget,
} from '@opencode-manager/shared/schemas'

function targetParams(target: MultiRunTarget): Record<string, string | number> {
  return target.kind === 'repo'
    ? { repoId: target.repoId }
    : { serverId: target.serverId, directory: target.directory }
}

export async function listMultiRuns(target: MultiRunTarget): Promise<MultiRun[]> {
  const res = await fetchWrapper<{ runs: MultiRun[] }>(`${API_BASE_URL}/api/multi-runs`, {
    params: targetParams(target),
  })
  return res.runs
}

export async function launchMultiRun(request: LaunchMultiRunRequest): Promise<MultiRun> {
  const res = await fetchWrapper<{ run: MultiRun }>(`${API_BASE_URL}/api/multi-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return res.run
}

export async function fuseMultiRun(runId: number, request: FuseMultiRunRequest): Promise<MultiRun> {
  const res = await fetchWrapper<{ run: MultiRun }>(
    `${API_BASE_URL}/api/multi-runs/${encodeURIComponent(runId)}/fusions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  )
  return res.run
}

export async function discardMultiRunEntry(runId: number, entryId: number): Promise<MultiRun> {
  const res = await fetchWrapper<{ run: MultiRun }>(
    `${API_BASE_URL}/api/multi-runs/${encodeURIComponent(runId)}/entries/${encodeURIComponent(entryId)}/discard`,
    { method: 'POST' },
  )
  return res.run
}
