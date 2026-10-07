import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  ChangeWalkthrough,
  ChangeWalkthroughState,
  GenerateChangeWalkthroughRequest,
} from '@opencode-manager/shared/schemas'

export async function getChangeWalkthrough(sessionId: string): Promise<ChangeWalkthroughState> {
  return fetchWrapper<ChangeWalkthroughState>(
    `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`,
  )
}

export async function generateChangeWalkthrough(
  sessionId: string,
  request: GenerateChangeWalkthroughRequest,
): Promise<ChangeWalkthrough> {
  const res = await fetchWrapper<{ walkthrough: ChangeWalkthrough }>(
    `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      timeout: 150_000,
    },
  )
  return res.walkthrough
}
