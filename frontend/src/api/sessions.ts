import { fetchWrapper } from './fetchWrapper'
import type {
  SessionData,
  SessionDetail,
  CreateSessionInput,
  DevcontainerUpdateRequest,
} from '@opencode-manager/shared'
import type { GitStatusResponse } from '@/types/git'

const API_BASE = '/api/sessions'

export const sessionsApi = {
  async listSessions(status?: string): Promise<SessionDetail[]> {
    const params = status ? { status } : undefined
    return fetchWrapper<SessionDetail[]>(API_BASE, { params })
  },

  async getSession(id: string): Promise<SessionDetail> {
    return fetchWrapper<SessionDetail>(`${API_BASE}/${id}`)
  },

  async getWorktreeStatuses(id: string): Promise<Record<number, GitStatusResponse>> {
    const data = await fetchWrapper<Record<string, GitStatusResponse>>(`${API_BASE}/${id}/worktree-status`)
    return Object.entries(data).reduce<Record<number, GitStatusResponse>>((acc, [key, value]) => {
      const repoId = Number(key)
      if (!Number.isNaN(repoId)) {
        acc[repoId] = value
      }
      return acc
    }, {})
  },

  async getOrCreateOpenCodeSession(id: string) {
    return fetchWrapper(`${API_BASE}/${id}/opencode-session`, {
      method: 'POST',
    })
  },

  async createSession(data: CreateSessionInput): Promise<SessionData> {
    return fetchWrapper<SessionData>(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  async deleteSession(id: string, keepWorktrees = false): Promise<{ success: boolean; deleted: boolean; worktreesKept: boolean }> {
    return fetchWrapper(`${API_BASE}/${id}`, {
      method: 'DELETE',
      params: keepWorktrees ? { keepWorktrees: 'true' } : undefined,
    })
  },

  async startSession(id: string): Promise<{ success: boolean; status: string }> {
    return fetchWrapper(`${API_BASE}/${id}/start`, {
      method: 'POST',
    })
  },

  async stopSession(id: string): Promise<{ success: boolean; status: string }> {
    return fetchWrapper(`${API_BASE}/${id}/stop`, {
      method: 'POST',
    })
  },

  async restartSession(id: string): Promise<{ success: boolean; status: string }> {
    return fetchWrapper(`${API_BASE}/${id}/restart`, {
      method: 'POST',
    })
  },

  async setPublicAccess(id: string, enabled: boolean): Promise<{ success: boolean; publicOpencodeUrl?: string }> {
    return fetchWrapper(`${API_BASE}/${id}/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
  },

  async listDevcontainerRequests(sessionId: string): Promise<DevcontainerUpdateRequest[]> {
    return fetchWrapper<DevcontainerUpdateRequest[]>(`${API_BASE}/${sessionId}/devcontainer-requests`)
  },

  async createDevcontainerRequest(
    sessionId: string,
    data: {
      templateName?: string
      requestedBy: string
      changes: Record<string, unknown>
      reason?: string
      action?: 'modify' | 'fork'
    }
  ): Promise<DevcontainerUpdateRequest> {
    return fetchWrapper<DevcontainerUpdateRequest>(`${API_BASE}/${sessionId}/devcontainer-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  async approveDevcontainerRequest(sessionId: string, requestId: number): Promise<{ success: boolean; status: string }> {
    return fetchWrapper(`${API_BASE}/${sessionId}/devcontainer-requests/${requestId}/approve`, {
      method: 'POST',
    })
  },

  async rejectDevcontainerRequest(sessionId: string, requestId: number): Promise<{ success: boolean; status: string }> {
    return fetchWrapper(`${API_BASE}/${sessionId}/devcontainer-requests/${requestId}/reject`, {
      method: 'POST',
    })
  },

  async applyDevcontainerRequest(sessionId: string, requestId: number): Promise<SessionDetail> {
    return fetchWrapper<SessionDetail>(`${API_BASE}/${sessionId}/devcontainer-requests/${requestId}/apply`, {
      method: 'POST',
    })
  },
}
