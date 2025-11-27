import axios, { type AxiosInstance } from 'axios'
import type { paths } from './opencode-types'

type SessionListResponse = paths['/session']['get']['responses']['200']['content']['application/json']
type SessionResponse = paths['/session/{id}']['get']['responses']['200']['content']['application/json']
type CreateSessionRequest = NonNullable<paths['/session']['post']['requestBody']>['content']['application/json']
type MessageListResponse = paths['/session/{id}/message']['get']['responses']['200']['content']['application/json']
type SendPromptRequest = NonNullable<paths['/session/{id}/message']['post']['requestBody']>['content']['application/json']
type ConfigResponse = paths['/config']['get']['responses']['200']['content']['application/json']
type CommandListResponse = paths['/command']['get']['responses']['200']['content']['application/json']
type CommandRequest = NonNullable<paths['/session/{id}/command']['post']['requestBody']>['content']['application/json']
type ShellRequest = NonNullable<paths['/session/{id}/shell']['post']['requestBody']>['content']['application/json']

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

  async sendPrompt(sessionID: string, data: SendPromptRequest) {
    const response = await this.client.post(`/session/${sessionID}/message`, data)
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
