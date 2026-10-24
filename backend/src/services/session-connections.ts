import { logger } from '../utils/logger'

export type SessionConnectionCloser = () => void

export const SESSION_CONNECTION_CLOSE_CODE = 1008

export const SESSION_CONNECTION_CLOSE_REASON = 'Session ended'

const connectionsBySession = new Map<string, Set<SessionConnectionCloser>>()

export function registerSessionConnection(sessionId: string, close: SessionConnectionCloser): () => void {
  let closers = connectionsBySession.get(sessionId)
  if (!closers) {
    closers = new Set()
    connectionsBySession.set(sessionId, closers)
  }
  closers.add(close)

  return () => {
    const current = connectionsBySession.get(sessionId)
    if (!current) return
    current.delete(close)
    if (current.size === 0) {
      connectionsBySession.delete(sessionId)
    }
  }
}

export function closeSessionConnections(sessionId: string): void {
  const closers = connectionsBySession.get(sessionId)
  if (!closers) return
  connectionsBySession.delete(sessionId)

  for (const close of closers) {
    try {
      close()
    } catch (error) {
      logger.error('Failed to close a session connection', { sessionId, error })
    }
  }
}
