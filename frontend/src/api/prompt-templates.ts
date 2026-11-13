import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { z } from 'zod'
import { PromptTemplateSchema } from '@opencode-manager/shared/schemas'
import type {
  PromptTemplate,
  CreatePromptTemplateRequest,
  UpdatePromptTemplateRequest,
} from '@opencode-manager/shared/types'

const promptTemplatesResponseSchema = z.object({ templates: z.array(PromptTemplateSchema) })
const promptTemplateResponseSchema = z.object({ template: PromptTemplateSchema })

export async function listPromptTemplates(): Promise<{ templates: PromptTemplate[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/prompt-templates`, promptTemplatesResponseSchema)
}

export async function createPromptTemplate(data: CreatePromptTemplateRequest): Promise<{ template: PromptTemplate }> {
  return fetchWrapper(`${API_BASE_URL}/api/prompt-templates`, promptTemplateResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updatePromptTemplate(id: number, data: UpdatePromptTemplateRequest): Promise<{ template: PromptTemplate }> {
  return fetchWrapper(`${API_BASE_URL}/api/prompt-templates/${id}`, promptTemplateResponseSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deletePromptTemplate(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/prompt-templates/${id}`, {
    method: 'DELETE',
  })
}
