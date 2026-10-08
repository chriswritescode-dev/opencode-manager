import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthroughState,
  GenerateChangeWalkthroughRequest,
  WalkthroughSource,
} from '@opencode-manager/shared/schemas'

function walkthroughUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`
}

export async function getChangeWalkthrough(
  sessionId: string,
  source: WalkthroughSource,
): Promise<ChangeWalkthroughState> {
  const query = `?source=${encodeURIComponent(walkthroughSourceKey(source))}`
  return fetchWrapper<ChangeWalkthroughState>(`${walkthroughUrl(sessionId)}${query}`)
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
