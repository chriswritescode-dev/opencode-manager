import {
  OpenCodeServerSchema,
  OpenCodeServerStatusSchema,
  OpenCodeServerTestResultSchema,
  type CreateOpenCodeServerRequest,
  type OpenCodeServer,
  type OpenCodeServerStatus,
  type OpenCodeServerTestResult,
  type TestOpenCodeServerRequest,
  type UpdateOpenCodeServerRequest,
} from '@opencode-manager/shared/schemas'
import { z } from 'zod'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

const OPENCODE_SERVERS_URL = `${API_BASE_URL}/api/opencode-servers`

const serverListResponseSchema = z.object({ servers: z.array(OpenCodeServerSchema) })
const serverStatusListResponseSchema = z.object({ statuses: z.array(OpenCodeServerStatusSchema) })
const serverResponseSchema = z.object({ server: OpenCodeServerSchema })

export interface CreateOpenCodeServerResponse {
  server: OpenCodeServer
  test: OpenCodeServerTestResult
}

const createServerResponseSchema: z.ZodType<CreateOpenCodeServerResponse> = z.object({
  server: OpenCodeServerSchema,
  test: OpenCodeServerTestResultSchema,
})

export async function listOpenCodeServers(): Promise<OpenCodeServer[]> {
  const response = await fetchWrapper(OPENCODE_SERVERS_URL, serverListResponseSchema)
  return response.servers
}

export async function listOpenCodeServerStatuses(): Promise<OpenCodeServerStatus[]> {
  const response = await fetchWrapper(
    `${OPENCODE_SERVERS_URL}/status`,
    serverStatusListResponseSchema,
  )
  return response.statuses
}

export async function createOpenCodeServer(
  input: CreateOpenCodeServerRequest,
): Promise<CreateOpenCodeServerResponse> {
  return fetchWrapper(OPENCODE_SERVERS_URL, createServerResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateOpenCodeServer(
  id: string,
  input: UpdateOpenCodeServerRequest,
): Promise<OpenCodeServer> {
  const response = await fetchWrapper(
    `${OPENCODE_SERVERS_URL}/${encodeURIComponent(id)}`,
    serverResponseSchema,
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
  return fetchWrapper(`${OPENCODE_SERVERS_URL}/test`, OpenCodeServerTestResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function testOpenCodeServerById(id: string): Promise<OpenCodeServerTestResult> {
  return fetchWrapper(
    `${OPENCODE_SERVERS_URL}/${encodeURIComponent(id)}/test`,
    OpenCodeServerTestResultSchema,
    { method: 'POST' },
  )
}
