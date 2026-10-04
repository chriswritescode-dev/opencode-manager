import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { LaunchMultiRunRequest, MultiRun } from '@opencode-manager/shared/schemas'

export async function listMultiRuns(repoId: number): Promise<MultiRun[]> {
  const res = await fetchWrapper<{ runs: MultiRun[] }>(`${API_BASE_URL}/api/multi-runs`, {
    params: { repoId },
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

export async function discardMultiRunEntry(runId: number, entryId: number): Promise<MultiRun> {
  const res = await fetchWrapper<{ run: MultiRun }>(
    `${API_BASE_URL}/api/multi-runs/${encodeURIComponent(runId)}/entries/${encodeURIComponent(entryId)}/discard`,
    { method: 'POST' },
  )
  return res.run
}
