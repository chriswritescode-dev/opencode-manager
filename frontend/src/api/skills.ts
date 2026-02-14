import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export interface Skill {
  name: string
  description: string
  content: string
  location: string
  createdAt?: number
  updatedAt?: number
}

export interface CreateSkillRequest {
  name: string
  description: string
  content: string
}

export interface UpdateSkillRequest {
  name?: string
  description?: string
  content?: string
}

export interface SkillsListResponse {
  skills: Skill[]
}

export const skillsApi = {
  listSkills: async (repoId: number): Promise<Skill[]> => {
    const response = await fetchWrapper<SkillsListResponse>(`${API_BASE_URL}/api/skills/${repoId}`)
    return response.skills
  },

  createSkill: async (repoId: number, data: CreateSkillRequest | FormData): Promise<Skill> => {
    const isFormData = data instanceof FormData
    
    return fetchWrapper<Skill>(`${API_BASE_URL}/api/skills/${repoId}`, {
      method: 'POST',
      headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
      body: data instanceof FormData ? data : JSON.stringify(data),
    })
  },

  updateSkill: async (repoId: number, name: string, data: UpdateSkillRequest): Promise<Skill> => {
    return fetchWrapper<Skill>(`${API_BASE_URL}/api/skills/${repoId}/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  deleteSkill: async (repoId: number, name: string): Promise<void> => {
    return fetchWrapper(`${API_BASE_URL}/api/skills/${repoId}/${name}`, {
      method: 'DELETE',
    })
  },
}
