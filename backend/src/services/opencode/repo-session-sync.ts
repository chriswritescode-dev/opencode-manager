import { logger } from '../../utils/logger'
import type { OpenCodeClient } from './client'
import type { RepoOpenCodeTargetManager } from './repo-target-manager'

export interface SyncSessionInput {
  repoId: number
  sessionId: string
  sourceBaseUrl: string
  sourceAuthHeader: string
  targetClient: OpenCodeClient
  directory: string
  reason: 'idle' | 'completed' | 'stop' | 'manual'
}

export interface SyncEvent {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: Record<string, unknown>
}

export class RepoSessionSyncService {
  constructor(private readonly targetManager: RepoOpenCodeTargetManager) {}

  async syncSession(input: SyncSessionInput): Promise<{ replayedEvents: number }> {
    const { repoId, sessionId, sourceBaseUrl, sourceAuthHeader, targetClient, directory, reason } = input

    logger.info(`Syncing session ${sessionId} for repo ${repoId} (reason: ${reason})`)

    try {
      const history = await this.fetchHistory(sourceBaseUrl, sourceAuthHeader, sessionId)
      const filteredEvents = history.filter((e) => e.aggregate_id === sessionId)

      if (filteredEvents.length === 0) {
        logger.info(`No events found for session ${sessionId}, skipping sync`)
        return { replayedEvents: 0 }
      }

      const replayResult = await this.replayToMain(targetClient, directory, filteredEvents)
      logger.info(`Successfully synced session ${sessionId} with ${replayResult.replayedEvents} events`, { replayedEvents: replayResult.replayedEvents })
      return replayResult
    } catch (error) {
      logger.error(`Failed to sync session ${sessionId} for repo ${repoId}:`, error)
      throw error
    }
  }

  private async fetchHistory(sourceBaseUrl: string, sourceAuthHeader: string, sessionId: string): Promise<SyncEvent[]> {
    const url = new URL('/sync/history', sourceBaseUrl)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: sourceAuthHeader,
    }

    const body = JSON.stringify({ [sessionId]: -1 })

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(`Failed to fetch sync history: ${response.status} ${bodyText}`)
    }

    const data = await response.json()
    return data as SyncEvent[]
  }

  private async replayToMain(targetClient: OpenCodeClient, directory: string, events: SyncEvent[]): Promise<{ replayedEvents: number }> {
    const replayBody = {
      directory,
      events: events.map((e) => ({
        id: e.id,
        aggregateID: e.aggregate_id,
        seq: e.seq,
        type: e.type,
        data: e.data,
      })),
    }

    await targetClient.postJson<{ session_id?: string }>('/sync/replay', replayBody)
    return { replayedEvents: events.length }
  }
}
