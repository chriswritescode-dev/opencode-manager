import { Database } from 'bun:sqlite'
import { opencodeServerManager } from './opencode-single-server'
import { SettingsService } from './settings'
import { logger } from '../utils/logger'
import type { SessionPruneConfig } from '@opencode-manager/shared/schemas'

interface PruneResult {
  deleted: number
  failed: number
  failedSessions: Array<{ id: string; error: string }>
  cutoffDays: number
  cutoffDate: string
}

interface Session {
  id: string
  title?: string
  directory: string
  parentID?: string
  time: { created: number; updated: number }
}

/**
 * Prune sessions older than the specified number of days
 */
export async function pruneSessions(days: number): Promise<PruneResult> {
  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000)
  const opencodePort = opencodeServerManager.getPort()
  
  // Get all sessions from OpenCode API
  const sessionsRes = await fetch(`http://127.0.0.1:${opencodePort}/session`)
  if (!sessionsRes.ok) {
    throw new Error('Failed to fetch sessions from OpenCode')
  }
  
  const allSessions = await sessionsRes.json() as Session[]
  
  // Filter to sessions older than cutoff and not child sessions
  const sessionsToDelete = allSessions.filter(session => {
    if (session.parentID) return false // Skip child sessions
    return session.time.updated < cutoffTime
  })
  
  logger.info(`Pruning ${sessionsToDelete.length} sessions older than ${days} days`)
  
  const deleted: string[] = []
  const failed: Array<{ id: string; error: string }> = []
  
  for (const session of sessionsToDelete) {
    try {
      const deleteRes = await fetch(
        `http://127.0.0.1:${opencodePort}/session/${session.id}?directory=${encodeURIComponent(session.directory)}`,
        { method: 'DELETE' }
      )
      
      if (deleteRes.ok) {
        deleted.push(session.id)
        logger.debug(`Deleted session ${session.id}`)
      } else {
        const errText = await deleteRes.text().catch(() => 'Unknown error')
        failed.push({ id: session.id, error: errText })
        logger.warn(`Failed to delete session ${session.id}: ${errText}`)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      failed.push({ id: session.id, error: errMsg })
      logger.warn(`Error deleting session ${session.id}:`, err)
    }
  }
  
  return {
    deleted: deleted.length,
    failed: failed.length,
    failedSessions: failed,
    cutoffDays: days,
    cutoffDate: new Date(cutoffTime).toISOString(),
  }
}

/**
 * Run auto-prune on startup if enabled in settings
 */
export async function autoPruneOnStartup(db: Database): Promise<void> {
  const settingsService = new SettingsService(db)
  const settings = settingsService.getSettings()
  
  const pruneConfig = settings.preferences.sessionPrune as SessionPruneConfig | undefined
  
  if (!pruneConfig?.enabled) {
    logger.debug('Session auto-prune is disabled')
    return
  }
  
  const days = pruneConfig.intervalDays || 7
  
  logger.info(`Auto-pruning sessions older than ${days} days...`)
  
  try {
    const result = await pruneSessions(days)
    
    logger.info(`Auto-prune completed: ${result.deleted} sessions deleted, ${result.failed} failed`)
    
    // Update lastPrunedAt timestamp
    settingsService.updateSettings({
      sessionPrune: {
        ...pruneConfig,
        lastPrunedAt: Date.now(),
      },
    })
    
  } catch (error) {
    logger.error('Auto-prune failed:', error)
  }
}
