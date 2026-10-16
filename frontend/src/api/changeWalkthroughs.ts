import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthroughState,
  GenerateChangeWalkthroughRequest,
  RefineChangeWalkthroughRequest,
  WalkthroughSource,
} from '@opencode-manager/shared/schemas'

function walkthroughUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`
}

export async function getChangeWalkthrough(
  sessionId: string,
  source: WalkthroughSource,
): Promise<ChangeWalkthroughState> {
  return fetchWrapper<ChangeWalkthroughState>(walkthroughUrl(sessionId), {
    params: { source: walkthroughSourceKey(source) },
  })
}

export async function generateChangeWalkthrough(
  sessionId: string,
  request: GenerateChangeWalkthroughRequest,
): Promise<ChangeWalkthroughState> {
  return fetchWrapper<ChangeWalkthroughState>(walkthroughUrl(sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function refineChangeWalkthrough(
  sessionId: string,
  request: RefineChangeWalkthroughRequest,
): Promise<ChangeWalkthroughState> {
  return fetchWrapper<ChangeWalkthroughState>(`${walkthroughUrl(sessionId)}/refine`, {
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
