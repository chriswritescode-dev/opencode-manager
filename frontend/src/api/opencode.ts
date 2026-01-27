import axios, { type AxiosInstance } from 'axios'
import type { paths } from './opencode-types'

type SessionListResponse = paths['/session']['get']['responses']['200']['content']['application/json']
type SessionResponse = paths['/session/{sessionID}']['get']['responses']['200']['content']['application/json']
type CreateSessionRequest = NonNullable<paths['/session']['post']['requestBody']>['content']['application/json']
type MessageListResponse = paths['/session/{sessionID}/message']['get']['responses']['200']['content']['application/json']
type SendPromptRequest = NonNullable<paths['/session/{sessionID}/message']['post']['requestBody']>['content']['application/json']
type ConfigResponse = paths['/config']['get']['responses']['200']['content']['application/json']
type CommandListResponse = paths['/command']['get']['responses']['200']['content']['application/json']
type CommandRequest = NonNullable<paths['/session/{sessionID}/command']['post']['requestBody']>['content']['application/json']
type ShellRequest = NonNullable<paths['/session/{sessionID}/shell']['post']['requestBody']>['content']['application/json']
type AgentListResponse = paths['/agent']['get']['responses']['200']['content']['application/json']
type QuestionListResponse = paths['/question']['get']['responses']['200']['content']['application/json']
type SendPromptResponse = paths['/session/{sessionID}/message']['post']['responses']['200']['content']['application/json']

export type { SendPromptResponse }

export class OpenCodeClient {
  private client: AxiosInstance
  private baseURL: string
  private directory?: string

  constructor(baseURL: string, directory?: string) {
    this.baseURL = baseURL
    this.directory = directory
    this.client = axios.create({
      baseURL,
      timeout: 30000
    })
    
    this.client.interceptors.request.use((config) => {
      if (this.directory) {
        config.params = { ...config.params, directory: this.directory }
      }
      return config
    })
  }

  setDirectory(directory: string) {
    this.directory = directory
  }

  async listSessions() {
    const response = await this.client.get<SessionListResponse>('/session')
    return response.data
  }

  async getSession(sessionID: string) {
    const response = await this.client.get<SessionResponse>(`/session/${sessionID}`)
    return response.data
  }

  async createSession(data: CreateSessionRequest) {
    const response = await this.client.post<SessionResponse>('/session', data)
    return response.data
  }

  async deleteSession(sessionID: string) {
    await this.client.delete(`/session/${sessionID}`)
  }

  async updateSession(sessionID: string, data: { title?: string }) {
    const response = await this.client.patch(`/session/${sessionID}`, data)
    return response.data
  }

  async forkSession(sessionID: string, messageID?: string) {
    const response = await this.client.post<SessionResponse>(`/session/${sessionID}/fork`, {
      messageID
    })
    return response.data
  }

  async abortSession(sessionID: string) {
    await this.client.post(`/session/${sessionID}/abort`)
  }

  async listMessages(sessionID: string) {
    const response = await this.client.get<MessageListResponse>(`/session/${sessionID}/message`)
    return response.data
  }

  async sendPrompt(sessionID: string, data: SendPromptRequest): Promise<SendPromptResponse> {
    const response = await this.client.post<SendPromptResponse>(
      `/session/${sessionID}/message`,
      data,
      { timeout: 0 }
    )
    return response.data
  }

  async summarizeSession(sessionID: string, providerID: string, modelID: string) {
    const response = await this.client.post(`/session/${sessionID}/summarize`, {
      providerID,
      modelID
    })
    return response.data
  }

  async getConfig() {
    const response = await this.client.get<ConfigResponse>('/config')
    return response.data
  }

  async updateConfig(config: Partial<ConfigResponse>) {
    const response = await this.client.patch<ConfigResponse>('/config', config)
    return response.data
  }

  async getProviders() {
    const response = await this.client.get('/provider')
    return response.data
  }

  async getConfigProviders() {
    const response = await this.client.get('/config/providers')
    return response.data
  }

  async listCommands() {
    const response = await this.client.get<CommandListResponse>('/command')
    return response.data
  }

  async sendCommand(sessionID: string, data: CommandRequest) {
    const response = await this.client.post(`/session/${sessionID}/command`, data)
    return response.data
  }

  async sendShell(sessionID: string, data: ShellRequest) {
    const response = await this.client.post(`/session/${sessionID}/shell`, data)
    return response.data
  }

  async respondToPermission(sessionID: string, permissionID: string, response: 'once' | 'always' | 'reject') {
    const result = await this.client.post(`/session/${sessionID}/permissions/${permissionID}`, { response })
    return result.data
  }

  async replyToQuestion(requestID: string, answers: string[][]) {
    const result = await this.client.post(`/question/${requestID}/reply`, { answers })
    return result.data
  }

  async rejectQuestion(requestID: string) {
    const result = await this.client.post(`/question/${requestID}/reject`)
    return result.data
  }

  async listPendingQuestions() {
    const response = await this.client.get<QuestionListResponse>('/question')
    return response.data
  }

  async listAgents() {
    const response = await this.client.get<AgentListResponse>('/agent')
    return response.data
  }

  async revertMessage(sessionID: string, data: { messageID: string, partID?: string }) {
    const response = await this.client.post(`/session/${sessionID}/revert`, data)
    return response.data
  }

  async unrevertSession(sessionID: string) {
    const response = await this.client.post(`/session/${sessionID}/unrevert`)
    return response.data
  }

  async getSessionStatuses() {
    const response = await this.client.get<Record<string, { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number }>>('/session/status')
    return response.data
  }

  getEventSourceURL() {
    const base = this.baseURL.startsWith('http') 
      ? this.baseURL 
      : `${window.location.origin}${this.baseURL}`
    const url = new URL(`${base}/event`)
    if (this.directory) {
      url.searchParams.set('directory', this.directory)
    }
    return url.toString()
  }
}

export const createOpenCodeClient = (baseURL: string, directory?: string) => {
  return new OpenCodeClient(baseURL, directory)
}
