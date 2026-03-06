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
          embedding float[${this.config.dimensions}] distance_metric=cosine,
          +memory_id INTEGER,
          +project_id TEXT
        )
      `)
      return
    }

    const row = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
    ).get() as { sql: string } | undefined

    if (!row) return

    const match = row.sql.match(/float\[(\d+)\]/i)
    const existingDimensions = match ? parseInt(match[1]!, 10) : null

    if (existingDimensions !== null && existingDimensions !== this.config.dimensions) {
      this.db.run('DROP TABLE IF EXISTS memory_embeddings')
      this.db.run(`
        CREATE VIRTUAL TABLE memory_embeddings USING vec0(
          embedding float[${this.config.dimensions}] distance_metric=cosine,
          +memory_id INTEGER,
          +project_id TEXT
        )
      `)
      return
    }

    if (!row.sql.includes('distance_metric=cosine')) {
      this.db.run('DROP TABLE IF EXISTS memory_embeddings')
      this.db.run(`
        CREATE VIRTUAL TABLE memory_embeddings USING vec0(
          embedding float[${this.config.dimensions}] distance_metric=cosine,
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
                embedding float[${dims}] distance_metric=cosine,
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
        const needsPostFilter = !!(projectId || scope)
        const knnLimit = needsPostFilter ? limit * 5 : limit

        let knnRows = this.db.prepare(`
          SELECT memory_id, distance
          FROM memory_embeddings
          WHERE embedding MATCH ?
          LIMIT ?
        `).all(embeddingJson, knnLimit) as Array<{ memory_id: number; distance: number }>

        if (needsPostFilter && knnRows.length > 0) {
          const ids = knnRows.map(r => r.memory_id)
          const placeholders = ids.map(() => '?').join(',')
          const conditions: string[] = [`id IN (${placeholders})`]
          const params: (string | number)[] = [...ids]

          if (projectId) {
            conditions.push('project_id = ?')
            params.push(projectId)
          }
          if (scope) {
            conditions.push('scope = ?')
            params.push(scope)
          }

          const validRows = this.db.prepare(
            `SELECT id FROM memories WHERE ${conditions.join(' AND ')}`
          ).all(...params) as Array<{ id: number }>
          const validIds = new Set(validRows.map(r => r.id))
          knnRows = knnRows.filter(r => validIds.has(r.memory_id))
        }

        const results = knnRows.slice(0, limit)
        return { results: results.map(r => ({ memoryId: r.memory_id, distance: r.distance })) }
      }

      case 'findSimilar': {
        const embedding = req.embedding as number[]
        const projectId = req.projectId as string
        const threshold = req.threshold as number
        const limit = req.limit as number
        const embeddingJson = JSON.stringify(embedding)

        const knnRows = this.db.prepare(`
          SELECT memory_id, distance
          FROM memory_embeddings
          WHERE embedding MATCH ?
          LIMIT ?
        `).all(embeddingJson, limit * 5) as Array<{ memory_id: number; distance: number }>

        const ids = knnRows.map(r => r.memory_id)
        if (ids.length === 0) {
          return { results: [] }
        }

        const placeholders = ids.map(() => '?').join(',')
        const projectRows = this.db.prepare(
          `SELECT id FROM memories WHERE id IN (${placeholders}) AND project_id = ?`
        ).all(...ids, projectId) as Array<{ id: number }>
        const validIds = new Set(projectRows.map(r => r.id))

        const filtered = knnRows
          .filter(r => validIds.has(r.memory_id) && r.distance < threshold)
          .slice(0, limit)
        return { results: filtered.map(r => ({ memoryId: r.memory_id, distance: r.distance })) }
      }

      case 'count': {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM memory_embeddings').get() as { count: number }
        return { count: row.count }
      }

      case 'countWithoutEmbeddings': {
        const projectId = req.projectId as string | undefined
        const embeddingsTableExists = this.db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
        ).get()

        if (!embeddingsTableExists) {
          const conditions: string[] = []
          const params: (string | number)[] = []
          if (projectId) {
            conditions.push('project_id = ?')
            params.push(projectId)
          }
          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
          const result = this.db.prepare(`SELECT COUNT(*) as count FROM memories ${where}`).get(...params) as { count: number }
          return { count: result.count }
        }

        const conditions: string[] = ['e.memory_id IS NULL']
        const params: (string | number)[] = []
        if (projectId) {
          conditions.push('m.project_id = ?')
          params.push(projectId)
        }
        const result = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memories m
          LEFT JOIN memory_embeddings e ON m.id = e.memory_id
          WHERE ${conditions.join(' AND ')}
        `).get(...params) as { count: number }
        return { count: result.count }
      }

      case 'getWithoutEmbeddings': {
        const projectId = req.projectId as string | undefined
        const limit = (req.limit as number) ?? 50
        const embeddingsTableExists = this.db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
        ).get()

        if (!embeddingsTableExists) {
          const conditions: string[] = []
          const params: (string | number)[] = []
          if (projectId) {
            conditions.push('project_id = ?')
            params.push(projectId)
          }
          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
          const rows = this.db.prepare(`
            SELECT id, content FROM memories ${where} ORDER BY created_at ASC LIMIT ?
          `).all(...params, limit) as Array<{ id: number; content: string }>
          return { rows }
        }

        const conditions: string[] = ['e.memory_id IS NULL']
        const params: (string | number)[] = []
        if (projectId) {
          conditions.push('m.project_id = ?')
          params.push(projectId)
        }
        const rows = this.db.prepare(`
          SELECT m.id, m.content
          FROM memories m
          LEFT JOIN memory_embeddings e ON m.id = e.memory_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY m.created_at ASC
          LIMIT ?
        `).all(...params, limit) as Array<{ id: number; content: string }>
        return { rows }
      }

      case 'recreateTable': {
        const dims = req.dimensions as number
        this.db.run('DROP TABLE IF EXISTS memory_embeddings')
        this.db.run(`
          CREATE VIRTUAL TABLE memory_embeddings USING vec0(
            embedding float[${dims}] distance_metric=cosine,
            +memory_id INTEGER,
            +project_id TEXT
          )
        `)
        return { status: 'ok' }
      }

      case 'getDimensions': {
        const row = this.db.prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_embeddings'"
        ).get() as { sql: string } | undefined
        if (!row) return { exists: false, dimensions: null }
        const match = row.sql.match(/float\[(\d+)\]/i)
        return { exists: true, dimensions: match ? parseInt(match[1]!, 10) : null }
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
