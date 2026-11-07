import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  OutputDefinition,
  OutputDefinitionInput,
  PromoteOutputDefinitionRequest,
} from '@opencode-manager/shared/schemas'

const OUTPUT_DEFINITIONS_URL = `${API_BASE_URL}/api/output-definitions`

function outputDefinitionUrl(id: string): string {
  return `${OUTPUT_DEFINITIONS_URL}/${encodeURIComponent(id)}`
}

export async function listOutputDefinitions(sessionId?: string): Promise<OutputDefinition[]> {
  const response = await fetchWrapper<{ definitions: OutputDefinition[] }>(OUTPUT_DEFINITIONS_URL, {
    params: { sessionId },
  })
  return response.definitions
}

export async function createOutputDefinition(input: OutputDefinitionInput): Promise<OutputDefinition> {
  const response = await fetchWrapper<{ definition: OutputDefinition }>(OUTPUT_DEFINITIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.definition
}

export async function putOutputDefinition(
  id: string,
  input: OutputDefinitionInput,
): Promise<OutputDefinition> {
  const response = await fetchWrapper<{ definition: OutputDefinition }>(outputDefinitionUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.definition
}

export async function deleteOutputDefinition(id: string): Promise<void> {
  await fetchWrapperVoid(outputDefinitionUrl(id), { method: 'DELETE' })
}

export async function promoteOutputDefinition(
  request: PromoteOutputDefinitionRequest,
): Promise<OutputDefinition> {
  const response = await fetchWrapper<{ definition: OutputDefinition }>(
    `${OUTPUT_DEFINITIONS_URL}/promote`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  )
  return response.definition
}
