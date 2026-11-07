import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { getFileApiUrl } from './files'
import type {
  GenerateOutputRequest,
  OutputParams,
  OutputState,
  RefineOutputRequest,
} from '@opencode-manager/shared/schemas'

const HELPER_SESSIONS_URL = `${API_BASE_URL}/api/outputs/helper-sessions`

function outputUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/outputs/${encodeURIComponent(sessionId)}`
}

function outputQuery(definitionId: string, params?: OutputParams): Record<string, string> {
  const query: Record<string, string> = { definitionId }
  if (params && Object.keys(params).length > 0) {
    query.params = JSON.stringify(params)
  }
  return query
}

export async function getOutputHelperSessionIds(): Promise<string[]> {
  const response = await fetchWrapper<{ sessionIds: string[] }>(HELPER_SESSIONS_URL)
  return response.sessionIds
}

export async function getOutputState(
  sessionId: string,
  definitionId: string,
  params?: OutputParams,
): Promise<OutputState> {
  return fetchWrapper<OutputState>(outputUrl(sessionId), {
    params: outputQuery(definitionId, params),
  })
}

export async function generateOutput(
  sessionId: string,
  request: GenerateOutputRequest,
): Promise<OutputState> {
  return fetchWrapper<OutputState>(outputUrl(sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function refineOutput(
  sessionId: string,
  request: RefineOutputRequest,
): Promise<OutputState> {
  return fetchWrapper<OutputState>(`${outputUrl(sessionId)}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function cancelOutput(
  sessionId: string,
  definitionId: string,
  params?: OutputParams,
): Promise<void> {
  await fetchWrapperVoid(outputUrl(sessionId), {
    method: 'DELETE',
    params: outputQuery(definitionId, params),
  })
}

export async function getOutputData(outputDir: string): Promise<unknown> {
  const path = `${outputDir.replace(/\/+$/, '')}/data.json`
  return fetchWrapper(getFileApiUrl(path, { params: { raw: true } }))
}
