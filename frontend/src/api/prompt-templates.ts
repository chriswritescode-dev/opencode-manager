import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  PromptTemplate,
  CreatePromptTemplateRequest,
  UpdatePromptTemplateRequest,
} from '@opencode-manager/shared/types'

export async function listPromptTemplates(): Promise<{ templates: PromptTemplate[] }> {
  return fetchWrapper(`${API_BASE_URL}/api/prompt-templates`)
}

export async function createPromptTemplate(data: CreatePromptTemplateRequest): Promise<{ template: PromptTemplate }> {
  return fetchWrapper(`${API_BASE_URL}/api/prompt-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updatePromptTemplate(id: number, data: UpdatePromptTemplateRequest): Promise<{ template: PromptTemplate }> {
  return fetchWrapper(`${API_BASE_URL}/api/prompt-templates/${id}`, {
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
