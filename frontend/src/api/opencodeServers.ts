import type {
  CreateOpenCodeServerRequest,
  OpenCodeServer,
  OpenCodeServerStatus,
  OpenCodeServerTestResult,
  TestOpenCodeServerRequest,
  UpdateOpenCodeServerRequest,
} from '@opencode-manager/shared/schemas'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

const OPENCODE_SERVERS_URL = `${API_BASE_URL}/api/opencode-servers`

export interface CreateOpenCodeServerResponse {
  server: OpenCodeServer
  test: OpenCodeServerTestResult
}

export async function listOpenCodeServers(): Promise<OpenCodeServer[]> {
  const response = await fetchWrapper<{ servers: OpenCodeServer[] }>(OPENCODE_SERVERS_URL)
  return response.servers
}

export async function listOpenCodeServerStatuses(): Promise<OpenCodeServerStatus[]> {
  const response = await fetchWrapper<{ statuses: OpenCodeServerStatus[] }>(
    `${OPENCODE_SERVERS_URL}/status`,
  )
  return response.statuses
}

export async function createOpenCodeServer(
  input: CreateOpenCodeServerRequest,
): Promise<CreateOpenCodeServerResponse> {
  return fetchWrapper<CreateOpenCodeServerResponse>(OPENCODE_SERVERS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateOpenCodeServer(
  id: string,
  input: UpdateOpenCodeServerRequest,
): Promise<OpenCodeServer> {
  const response = await fetchWrapper<{ server: OpenCodeServer }>(
    `${OPENCODE_SERVERS_URL}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return response.server
}

export async function deleteOpenCodeServer(id: string): Promise<void> {
  return fetchWrapperVoid(`${OPENCODE_SERVERS_URL}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function testOpenCodeServer(
  input: TestOpenCodeServerRequest,
): Promise<OpenCodeServerTestResult> {
  return fetchWrapper<OpenCodeServerTestResult>(`${OPENCODE_SERVERS_URL}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function testOpenCodeServerById(id: string): Promise<OpenCodeServerTestResult> {
  return fetchWrapper<OpenCodeServerTestResult>(
    `${OPENCODE_SERVERS_URL}/${encodeURIComponent(id)}/test`,
    { method: 'POST' },
  )
}
