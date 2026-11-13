import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { z } from 'zod'
import { ChangeWalkthroughStateSchema, walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthroughState,
  GenerateChangeWalkthroughRequest,
  RefineChangeWalkthroughRequest,
  WalkthroughSource,
} from '@opencode-manager/shared/schemas'

function walkthroughUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`
}

const HELPER_SESSIONS_URL = `${API_BASE_URL}/api/change-walkthroughs/helper-sessions`

const helperSessionIdsSchema = z.object({ sessionIds: z.array(z.string()) })

export async function getWalkthroughHelperSessionIds(): Promise<string[]> {
  const response = await fetchWrapper(HELPER_SESSIONS_URL, helperSessionIdsSchema)
  return response.sessionIds
}

export async function getChangeWalkthrough(
  sessionId: string,
  source: WalkthroughSource,
): Promise<ChangeWalkthroughState> {
  return fetchWrapper(walkthroughUrl(sessionId), ChangeWalkthroughStateSchema, {
    params: { source: walkthroughSourceKey(source) },
  })
}

export async function generateChangeWalkthrough(
  sessionId: string,
  request: GenerateChangeWalkthroughRequest,
): Promise<ChangeWalkthroughState> {
  return fetchWrapper(walkthroughUrl(sessionId), ChangeWalkthroughStateSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function refineChangeWalkthrough(
  sessionId: string,
  request: RefineChangeWalkthroughRequest,
): Promise<ChangeWalkthroughState> {
  return fetchWrapper(`${walkthroughUrl(sessionId)}/refine`, ChangeWalkthroughStateSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function cancelChangeWalkthrough(
  sessionId: string,
  source: WalkthroughSource,
): Promise<void> {
  await fetchWrapperVoid(walkthroughUrl(sessionId), {
    method: 'DELETE',
    params: { source: walkthroughSourceKey(source) },
  })
}
