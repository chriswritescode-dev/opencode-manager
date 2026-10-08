import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  ChangeWalkthroughState,
  GenerateChangeWalkthroughRequest,
} from '@opencode-manager/shared/schemas'

function walkthroughUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`
}

export async function getChangeWalkthrough(sessionId: string): Promise<ChangeWalkthroughState> {
  return fetchWrapper<ChangeWalkthroughState>(walkthroughUrl(sessionId))
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
