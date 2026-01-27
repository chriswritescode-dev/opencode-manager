import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import { opencodeServerManager } from '../services/opencode-single-server'
import { logger } from '../utils/logger'

interface SessionWithRepo {
  id: string
  title: string
  directory: string
  repoId?: number
  repoName?: string
  status?: 'idle' | 'busy' | 'retry'
  time: {
    created: number
    updated: number
  }
}

export function createSessionRoutes(database: Database) {
  const app = new Hono()
  
  app.get('/recent', async (c) => {
    try {
      const hoursParam = c.req.query('hours')
      const hours = hoursParam ? parseInt(hoursParam, 10) : 8
      const cutoffTime = Date.now() - (hours * 60 * 60 * 1000)
      
      const repos = db.listRepos(database)
      const opencodePort = opencodeServerManager.getPort()
      
      const recentSessions: SessionWithRepo[] = []
      
      let sessionStatuses: Record<string, { type: string }> = {}
      try {
        const statusRes = await fetch(`http://127.0.0.1:${opencodePort}/session/status`)
        if (statusRes.ok) {
          sessionStatuses = await statusRes.json()
        }
      } catch (err) {
        logger.warn('Failed to fetch session statuses:', err)
      }
      
      for (const repo of repos) {
        try {
          const sessionsRes = await fetch(
            `http://127.0.0.1:${opencodePort}/session?directory=${encodeURIComponent(repo.fullPath)}`
          )
          
          if (!sessionsRes.ok) continue
          
          const sessions = await sessionsRes.json() as Array<{
            id: string
            title?: string
            directory: string
            parentID?: string
            time: { created: number; updated: number }
          }>
          
          for (const session of sessions) {
            if (session.parentID) continue
            if (session.time.updated < cutoffTime) continue
            
            const status = sessionStatuses[session.id]
            
            recentSessions.push({
              id: session.id,
              title: session.title || 'Untitled Session',
              directory: session.directory,
              repoId: repo.id,
              repoName: repo.name,
              status: (status?.type as 'idle' | 'busy' | 'retry') || 'idle',
              time: session.time,
            })
          }
        } catch (err) {
          logger.warn(`Failed to fetch sessions for repo ${repo.id}:`, err)
        }
      }
      
      recentSessions.sort((a, b) => b.time.updated - a.time.updated)
      
      return c.json({
        sessions: recentSessions,
        cutoffTime,
        count: recentSessions.length,
      })
    } catch (error: unknown) {
      logger.error('Failed to get recent sessions:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: message }, 500)
    }
  })
  
  return app
}
