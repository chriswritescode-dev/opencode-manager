import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type { Memory, MemoryStats, CreateMemoryRequest, UpdateMemoryRequest, PluginConfig } from '@opencode-manager/shared/types'

export async function listMemories(filters?: {
  projectId?: string
  scope?: string
  content?: string
  limit?: number
  offset?: number
}): Promise<{ memories: Memory[] }> {
  const params = new URLSearchParams()
  if (filters?.projectId) params.set('projectId', filters.projectId)
  if (filters?.scope) params.set('scope', filters.scope)
  if (filters?.content) params.set('content', filters.content)
  if (filters?.limit) params.set('limit', String(filters.limit))
  if (filters?.offset) params.set('offset', String(filters.offset))

  const query = params.toString()
  return fetchWrapper(`${API_BASE_URL}/api/memory${query ? `?${query}` : ''}`)
}

export async function createMemory(data: CreateMemoryRequest): Promise<{ memory: Memory }> {
  return fetchWrapper(`${API_BASE_URL}/api/memory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function getMemory(id: number): Promise<{ memory: Memory }> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/${id}`)
}

export async function updateMemory(id: number, data: UpdateMemoryRequest): Promise<{ memory: Memory }> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteMemory(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/memory/${id}`, {
    method: 'DELETE',
  })
}

export async function getProjectSummary(
  repoId: number
): Promise<{ projectId: string | null; stats: MemoryStats; error?: string }> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/project-summary?repoId=${repoId}`)
}

export async function getPluginConfig(): Promise<{ config: PluginConfig }> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/plugin-config`)
}

export async function updatePluginConfig(config: PluginConfig): Promise<{ success: boolean; config: PluginConfig }> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/plugin-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}

export interface ReindexResult {
  success: boolean
  message: string
  total: number
  embedded: number
  failed: number
  requiresRestart?: boolean
}

export async function reindexMemories(): Promise<ReindexResult> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/reindex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface TestEmbeddingResult {
  success: boolean
  error?: string
  message?: string
  dimensions?: number
}

export async function testEmbeddingConfig(): Promise<TestEmbeddingResult> {
  return fetchWrapper(`${API_BASE_URL}/api/memory/test-embedding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}
