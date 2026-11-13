import {
  ManagerLogsResponseSchema,
  type ManagerLogLevel,
  type ManagerLogSource,
  type ManagerLogsResponse,
} from '@opencode-manager/shared/schemas'
import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export interface GetManagerLogsQuery {
  afterSeq?: number
  level?: ManagerLogLevel
  source?: ManagerLogSource
  limit?: number
}

export const logsApi = {
  getManagerLogs: (query: GetManagerLogsQuery = {}): Promise<ManagerLogsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/logs`, ManagerLogsResponseSchema, {
      params: { ...query },
    })
  },
}
