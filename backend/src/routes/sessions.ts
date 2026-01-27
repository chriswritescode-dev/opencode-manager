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
  summary?: string
  time: {
    created: number
    updated: number
  }
}

interface MessagePart {
  type: string
  text?: string
}

interface SessionMessage {
  info: {
    id: string
    role: string
  }
  parts: MessagePart[]
}

async function getSessionSummary(
  opencodePort: number,
  sessionId: string,
  directory: string
): Promise<string | undefined> {
  try {
    const messagesRes = await fetch(
      `http://127.0.0.1:${opencodePort}/session/${sessionId}/message?directory=${encodeURIComponent(directory)}`
    )
    if (!messagesRes.ok) return undefined
    
    const messages = await messagesRes.json() as SessionMessage[]
    
    for (const msg of messages) {
      if (msg.info.role === 'user' && msg.parts?.length > 0) {
        const textPart = msg.parts.find(p => p.type === 'text' && p.text)
        if (textPart?.text) {
          const text = textPart.text.trim()
          return text.length > 120 ? text.slice(0, 117) + '...' : text
        }
      }
    }
  } catch {
    // Ignore errors fetching messages
  }
  return undefined
}

function getRepoDisplayName(repo: { repoUrl?: string | null; localPath?: string | null; fullPath: string }): string {
  if (repo.repoUrl) {
    const match = repo.repoUrl.match(/\/([^/]+?)(?:\.git)?$/)
    return match ? match[1] : repo.repoUrl
  }
  if (repo.localPath) {
    return repo.localPath.split('/').pop() || repo.localPath
  }
  return repo.fullPath.split('/').pop() || repo.fullPath
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
            const summary = await getSessionSummary(opencodePort, session.id, session.directory)
            
            recentSessions.push({
              id: session.id,
              title: session.title || 'Untitled Session',
              directory: session.directory,
              repoId: repo.id,
              repoName: getRepoDisplayName(repo),
              status: (status?.type as 'idle' | 'busy' | 'retry') || 'idle',
              summary,
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
