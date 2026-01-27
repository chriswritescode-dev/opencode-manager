import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import { opencodeServerManager } from './opencode-single-server'
import { sendSessionCompleteNotification, sendPermissionRequestNotification } from './push'
import { logger } from '../utils/logger'

interface SSEEvent {
  type: string
  properties: Record<string, unknown>
}

type EventSourceType = typeof globalThis.EventSource

let globalEventSources: Map<string, InstanceType<EventSourceType>> = new Map()
let database: Database | null = null
let isRunning = false

async function getSessionTitle(directory: string, sessionId: string): Promise<string | undefined> {
  try {
    const port = opencodeServerManager.getPort()
    const response = await fetch(
      `http://127.0.0.1:${port}/session/${sessionId}?directory=${encodeURIComponent(directory)}`
    )
    if (response.ok) {
      const session = await response.json()
      return session.title
    }
  } catch (err) {
    logger.warn(`Failed to fetch session title for ${sessionId}:`, err)
  }
  return undefined
}

function getRepoIdByDirectory(directory: string): number | undefined {
  if (!database) return undefined
  const repos = db.listRepos(database)
  const repo = repos.find((r) => r.fullPath === directory)
  return repo?.id
}

function handleSSEMessage(directory: string, event: SSEEvent): void {
  if (!database) return

  const { type, properties: props } = event

  if (type === 'session.idle' && 'sessionID' in props) {
    const sessionId = props.sessionID as string
    const repoId = getRepoIdByDirectory(directory)

    logger.info(`[GlobalSSE] Session idle: ${sessionId} in ${directory}`)

    getSessionTitle(directory, sessionId).then((title) => {
      sendSessionCompleteNotification(database!, sessionId, repoId?.toString(), title)
        .catch((err) => logger.warn('[GlobalSSE] Failed to send push notification:', err))
    })
  }

  if (type === 'permission.updated' && 'id' in props && 'sessionID' in props) {
    const sessionId = props.sessionID as string
    const toolName = (props.tool as string) || 'A tool'
    const repoId = getRepoIdByDirectory(directory)

    logger.info(`[GlobalSSE] Permission requested: ${toolName} for session ${sessionId}`)

    sendPermissionRequestNotification(database!, sessionId, toolName, repoId?.toString())
      .catch((err) => logger.warn('[GlobalSSE] Failed to send permission push notification:', err))
  }
}

function connectToRepo(directory: string): void {
  if (globalEventSources.has(directory)) {
    return
  }

  const port = opencodeServerManager.getPort()
  const url = `http://127.0.0.1:${port}/event?directory=${encodeURIComponent(directory)}`

  logger.info(`[GlobalSSE] Connecting to ${directory}`)

  const EventSourceClass = globalThis.EventSource
  const es = new EventSourceClass(url)
  globalEventSources.set(directory, es)

  es.onopen = () => {
    logger.info(`[GlobalSSE] Connected to ${directory}`)
  }

  es.onerror = (err) => {
    logger.warn(`[GlobalSSE] Error for ${directory}:`, err)
    globalEventSources.delete(directory)

    if (isRunning) {
      setTimeout(() => {
        if (isRunning && !globalEventSources.has(directory)) {
          connectToRepo(directory)
        }
      }, 5000)
    }
  }

  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as SSEEvent
      handleSSEMessage(directory, event)
    } catch (err) {
      logger.warn('[GlobalSSE] Failed to parse SSE event:', err)
    }
  }
}

function disconnectFromRepo(directory: string): void {
  const es = globalEventSources.get(directory)
  if (es) {
    es.close()
    globalEventSources.delete(directory)
    logger.info(`[GlobalSSE] Disconnected from ${directory}`)
  }
}

function syncRepoConnections(): void {
  if (!database) return

  const repos = db.listRepos(database)
  const currentDirs = new Set(repos.map((r) => r.fullPath))

  for (const [dir] of globalEventSources) {
    if (!currentDirs.has(dir)) {
      disconnectFromRepo(dir)
    }
  }

  for (const repo of repos) {
    if (!globalEventSources.has(repo.fullPath)) {
      connectToRepo(repo.fullPath)
    }
  }
}

export function startGlobalSSEListener(db: Database): void {
  if (isRunning) return

  database = db
  isRunning = true

  logger.info('[GlobalSSE] Starting global SSE listener')

  syncRepoConnections()

  setInterval(() => {
    if (isRunning) {
      syncRepoConnections()
    }
  }, 30000)
}

export function stopGlobalSSEListener(): void {
  isRunning = false

  for (const [dir] of globalEventSources) {
    disconnectFromRepo(dir)
  }

  logger.info('[GlobalSSE] Stopped global SSE listener')
}
