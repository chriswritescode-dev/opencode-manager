import type { paths } from './opencode-types'
import { fetchWrapper } from './fetchWrapper'

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
  private baseURL: string
  private directory?: string

  constructor(baseURL: string, directory?: string) {
    this.baseURL = baseURL
    this.directory = directory
  }

  setDirectory(directory: string) {
    this.directory = directory
  }

  private getParams(params?: Record<string, string>) {
    if (!this.directory) return params
    return { ...params, directory: this.directory }
  }

  async listSessions() {
    return fetchWrapper<SessionListResponse>(`${this.baseURL}/session`, {
      params: this.getParams(),
    })
  }

  async getSession(sessionID: string) {
    return fetchWrapper<SessionResponse>(`${this.baseURL}/session/${sessionID}`, {
      params: this.getParams(),
    })
  }

  async createSession(data: CreateSessionRequest) {
    return fetchWrapper<SessionResponse>(`${this.baseURL}/session`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async deleteSession(sessionID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}`, {
      method: 'DELETE',
      params: this.getParams(),
    })
  }

  async updateSession(sessionID: string, data: { title?: string }) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}`, {
      method: 'PATCH',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async forkSession(sessionID: string, messageID?: string) {
    return fetchWrapper<SessionResponse>(`${this.baseURL}/session/${sessionID}/fork`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageID }),
    })
  }

  async abortSession(sessionID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/abort`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async listMessages(sessionID: string) {
    return fetchWrapper<MessageListResponse>(`${this.baseURL}/session/${sessionID}/message`, {
      params: this.getParams(),
    })
  }

  async sendPrompt(sessionID: string, data: SendPromptRequest): Promise<SendPromptResponse> {
    return fetchWrapper<SendPromptResponse>(
      `${this.baseURL}/session/${sessionID}/message`,
      {
        method: 'POST',
        params: this.getParams(),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        timeout: 0,
      }
    )
  }

  async summarizeSession(sessionID: string, providerID: string, modelID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/summarize`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerID, modelID }),
    })
  }

  async getConfig() {
    return fetchWrapper<ConfigResponse>(`${this.baseURL}/config`, {
      params: this.getParams(),
    })
  }

  async updateConfig(config: Partial<ConfigResponse>) {
    return fetchWrapper<ConfigResponse>(`${this.baseURL}/config`, {
      method: 'PATCH',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  }

  async getProviders() {
    return fetchWrapper(`${this.baseURL}/provider`, {
      params: this.getParams(),
    })
  }

  async getConfigProviders() {
    return fetchWrapper(`${this.baseURL}/config/providers`, {
      params: this.getParams(),
    })
  }

  async listCommands() {
    return fetchWrapper<CommandListResponse>(`${this.baseURL}/command`, {
      params: this.getParams(),
    })
  }

  async sendCommand(sessionID: string, data: CommandRequest) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/command`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async sendShell(sessionID: string, data: ShellRequest) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/shell`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async respondToPermission(sessionID: string, permissionID: string, response: 'once' | 'always' | 'reject') {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/permissions/${permissionID}`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    })
  }

  async replyToQuestion(requestID: string, answers: string[][]) {
    return fetchWrapper(`${this.baseURL}/question/${requestID}/reply`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
  }

  async rejectQuestion(requestID: string) {
    return fetchWrapper(`${this.baseURL}/question/${requestID}/reject`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async listPendingQuestions() {
    return fetchWrapper<QuestionListResponse>(`${this.baseURL}/question`, {
      params: this.getParams(),
    })
  }

  async listAgents() {
    return fetchWrapper<AgentListResponse>(`${this.baseURL}/agent`, {
      params: this.getParams(),
    })
  }

  async revertMessage(sessionID: string, data: { messageID: string, partID?: string }) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/revert`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async unrevertSession(sessionID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/unrevert`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async getSessionStatuses() {
    return fetchWrapper<Record<string, { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number }>>(`${this.baseURL}/session/status`, {
      params: this.getParams(),
    })
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
