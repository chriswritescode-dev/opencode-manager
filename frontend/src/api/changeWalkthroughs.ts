import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { walkthroughSourceKey } from '@opencode-manager/shared/schemas'
import type {
  ChangeWalkthroughState,
  ChangeWalkthroughStateWire,
  GenerateChangeWalkthroughRequest,
  WalkthroughSource,
} from '@opencode-manager/shared/schemas'

function walkthroughUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/change-walkthroughs/${encodeURIComponent(sessionId)}`
}

export async function getChangeWalkthrough(
  sessionId: string,
  source: WalkthroughSource,
  hunksFor?: string,
): Promise<ChangeWalkthroughStateWire> {
  return fetchWrapper<ChangeWalkthroughStateWire>(walkthroughUrl(sessionId), {
    params: {
      source: walkthroughSourceKey(source),
      ...(hunksFor === undefined ? {} : { hunksFor }),
    },
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

export async function cancelChangeWalkthrough(
  sessionId: string,
  source: WalkthroughSource,
): Promise<void> {
  await fetchWrapperVoid(walkthroughUrl(sessionId), {
    method: 'DELETE',
    params: { source: walkthroughSourceKey(source) },
  })
}
