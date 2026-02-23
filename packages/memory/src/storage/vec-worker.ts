import { Database } from 'bun:sqlite'
import { createServer } from 'net'
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'node:module'
import { platform } from 'os'

interface WorkerConfig {
  dbPath: string
  socketPath: string
  pidPath: string
  dimensions: number
}

const require = createRequire(import.meta.url)

function resolveHomebrewSqlitePath(): string | null {
  const candidates = [
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

if (platform() === 'darwin') {
  const sqlitePath = resolveHomebrewSqlitePath()
  if (sqlitePath) {
    Database.setCustomSQLite(sqlitePath)
  }
}

class VecWorker {
  private db: Database
  private server: ReturnType<typeof createServer> | null = null
  private config: WorkerConfig

  constructor(config: WorkerConfig) {
    this.config = config
    this.db = new Database(config.dbPath)
    this.db.run('PRAGMA journal_mode=WAL')
    this.db.run('PRAGMA busy_timeout=5000')

    const { getLoadablePath } = require('sqlite-vec')
    this.db.loadExtension(getLoadablePath())

    this.initTables()
  }

  private initTables(): void {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
    ).get()

    if (!exists) {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
          embedding float[${this.config.dimensions}],
          +memory_id INTEGER,
          +project_id TEXT
        )
      `)
    }
  }

  start(): void {
    const { socketPath, pidPath } = this.config
    const socketDir = join(socketPath, '..')
    if (!existsSync(socketDir)) {
      mkdirSync(socketDir, { recursive: true })
    }
    if (existsSync(socketPath)) {
      unlinkSync(socketPath)
    }

    writeFileSync(pidPath, String(process.pid), 'utf-8')

    this.server = createServer((socket) => {
      let buffer = ''
      socket.on('data', (data) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const request = JSON.parse(line)
            const response = this.handle(request)
            socket.write(JSON.stringify(response) + '\n')
          } catch (error) {
            socket.write(JSON.stringify({
              error: error instanceof Error ? error.message : String(error)
            }) + '\n')
          }
        }
      })
      socket.on('error', () => {})
    })

    this.server.listen(socketPath)
    process.on('SIGTERM', () => this.shutdown())
    process.on('SIGINT', () => this.shutdown())
  }

  private handle(req: Record<string, unknown>): Record<string, unknown> {
    switch (req.action) {
      case 'health':
        return { status: 'ok' }

      case 'init': {
        const dims = req.dimensions as number
        if (dims) {
          const exists = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
          ).get()
          if (!exists) {
            this.db.run(`
              CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
                embedding float[${dims}],
                +memory_id INTEGER,
                +project_id TEXT
              )
            `)
          }
        }
        return { status: 'ok' }
      }

      case 'insert': {
        const embedding = req.embedding as number[]
        const memoryId = req.memoryId as number
        const projectId = req.projectId as string
        this.db.prepare(
          'INSERT INTO memory_embeddings (embedding, memory_id, project_id) VALUES (?, ?, ?)'
        ).run(JSON.stringify(embedding), memoryId, projectId)
        return { status: 'ok' }
      }

      case 'delete': {
        const memoryId = req.memoryId as number
        this.db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(memoryId)
        return { status: 'ok' }
      }

      case 'deleteByProject': {
        const projectId = req.projectId as string
        this.db.prepare('DELETE FROM memory_embeddings WHERE project_id = ?').run(projectId)
        return { status: 'ok' }
      }

      case 'deleteByMemoryIds': {
        const ids = req.memoryIds as number[]
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',')
          this.db.prepare(`DELETE FROM memory_embeddings WHERE memory_id IN (${placeholders})`).run(...ids)
        }
        return { status: 'ok' }
      }

      case 'search': {
        const embedding = req.embedding as number[]
        const projectId = req.projectId as string | undefined
        const scope = req.scope as string | undefined
        const limit = (req.limit as number) ?? 10
        const embeddingJson = JSON.stringify(embedding)

        const conditions: string[] = []
        const params: (string | number)[] = [embeddingJson]

        if (projectId) {
          conditions.push('e.project_id = ?')
          params.push(projectId)
        }
        if (scope) {
          conditions.push('m.scope = ?')
          params.push(scope)
        }

        params.push(limit)

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
        const rows = this.db.prepare(`
          SELECT e.memory_id, (e.embedding <=> ?) as distance
          FROM memory_embeddings e
          JOIN memories m ON m.id = e.memory_id
          ${where}
          ORDER BY distance
          LIMIT ?
        `).all(...params) as Array<{ memory_id: number; distance: number }>

        return { results: rows.map(r => ({ memoryId: r.memory_id, distance: r.distance })) }
      }

      case 'findSimilar': {
        const embedding = req.embedding as number[]
        const projectId = req.projectId as string
        const threshold = req.threshold as number
        const limit = req.limit as number
        const embeddingJson = JSON.stringify(embedding)

        const rows = this.db.prepare(`
          SELECT e.memory_id, (e.embedding <=> ?) as distance
          FROM memory_embeddings e
          JOIN memories m ON m.id = e.memory_id
          WHERE m.project_id = ?
            AND (e.embedding <=> ?) < ?
          ORDER BY distance LIMIT ?
        `).all(embeddingJson, projectId, embeddingJson, threshold, limit) as Array<{
          memory_id: number
          distance: number
        }>

        return { results: rows.map(r => ({ memoryId: r.memory_id, distance: r.distance })) }
      }

      case 'count': {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM memory_embeddings').get() as { count: number }
        return { count: row.count }
      }

      default:
        return { error: `Unknown action: ${req.action}` }
    }
  }

  private shutdown(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    try {
      if (existsSync(this.config.socketPath)) unlinkSync(this.config.socketPath)
    } catch {}
    try {
      if (existsSync(this.config.pidPath)) unlinkSync(this.config.pidPath)
    } catch {}
    this.db.close()
    process.exit(0)
  }
}

function parseArgs(): WorkerConfig {
  const args = process.argv.slice(2)
  let dbPath = ''
  let socketPath = ''
  let pidPath = ''
  let dimensions = 384

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--db': dbPath = args[++i]; break
      case '--socket': socketPath = args[++i]; break
      case '--pid': pidPath = args[++i]; break
      case '--dimensions': dimensions = parseInt(args[++i], 10); break
    }
  }

  return { dbPath, socketPath, pidPath, dimensions }
}

const config = parseArgs()
const worker = new VecWorker(config)
worker.start()
