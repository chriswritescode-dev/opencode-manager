import { apiClient } from './client'

export interface ScheduledTask {
  id: number
  name: string
  schedule_type: 'cron'
  schedule_value: string
  command_type: 'skill' | 'opencode-run' | 'script'
  command_config: string
  status: 'active' | 'paused'
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export interface CommandConfig {
  command?: string
  args?: string[]
  workdir?: string
  skillName?: string
  message?: string
}

export interface CreateTaskInput {
  name: string
  schedule_type: 'cron'
  schedule_value: string
  command_type: 'skill' | 'opencode-run' | 'script'
  command_config: CommandConfig
}

export interface UpdateTaskInput {
  name?: string
  schedule_value?: string
  command_type?: 'skill' | 'opencode-run' | 'script'
  command_config?: CommandConfig
}

export interface TaskRunResult {
  success: boolean
  output: string
  error?: string
  duration: number
}

export async function getTasks(): Promise<ScheduledTask[]> {
  const response = await apiClient.get('/api/tasks')
  return response.data
}

export async function getTask(id: number): Promise<ScheduledTask> {
  const response = await apiClient.get(`/api/tasks/${id}`)
  return response.data
}

export async function createTask(input: CreateTaskInput): Promise<ScheduledTask> {
  const response = await apiClient.post('/api/tasks', input)
  return response.data
}

export async function updateTask(id: number, input: UpdateTaskInput): Promise<ScheduledTask> {
  const response = await apiClient.put(`/api/tasks/${id}`, input)
  return response.data
}

export async function deleteTask(id: number): Promise<void> {
  await apiClient.delete(`/api/tasks/${id}`)
}

export async function toggleTask(id: number): Promise<ScheduledTask> {
  const response = await apiClient.post(`/api/tasks/${id}/toggle`)
  return response.data
}

export async function runTaskNow(id: number): Promise<TaskRunResult> {
  const response = await apiClient.post(`/api/tasks/${id}/run`)
  return response.data
}

export function parseCommandConfig(configString: string): CommandConfig {
  try {
    return JSON.parse(configString)
  } catch {
    return {}
  }
}

export function formatCronExpression(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return cron

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayName = days[parseInt(dayOfWeek)] || dayOfWeek
    return `Every ${dayName} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour'
  }

  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`
  }

  return cron
}

export function formatNextRun(timestamp: number | null): string {
  if (!timestamp) return 'Not scheduled'
  
  const date = new Date(timestamp)
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  
  if (diff < 0) return 'Overdue'
  if (diff < 60000) return 'In less than a minute'
  if (diff < 3600000) return `In ${Math.floor(diff / 60000)} minutes`
  if (diff < 86400000) return `In ${Math.floor(diff / 3600000)} hours`
  
  return date.toLocaleString()
}

export function formatLastRun(timestamp: number | null): string {
  if (!timestamp) return 'Never'
  
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`
  
  return date.toLocaleString()
}
