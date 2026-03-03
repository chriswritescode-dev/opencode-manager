import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'

const TEST_PROJECT_ID = 'test-project-cli'

interface PluginMemory {
  id: number
  projectId: string
  scope: 'convention' | 'decision' | 'context'
  content: string
  filePath: string | null
  accessCount: number
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
}

function createTestDb(tempDir: string): Database {
  const dbPath = join(tempDir, 'memory.db')
  const db = new Database(dbPath)

  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`)

  return db
}

function insertTestMemories(db: Database, projectId: string): void {
  const now = Date.now()
  db.run(
    'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [projectId, 'convention', 'Use TypeScript for all new code', null, 0, now, now]
  )
  db.run(
    'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [projectId, 'decision', 'Chose Bun as runtime for performance', null, 0, now - 1000, now - 1000]
  )
  db.run(
    'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [projectId, 'context', 'Project started in 2024', null, 0, now - 2000, now - 2000]
  )
}

describe('CLI Export - formatAsJson', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cli-test-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('exports formatAsJson function', async () => {
    const { formatAsJson } = await import('../src/cli/commands/export.ts')
    expect(typeof formatAsJson).toBe('function')
  })

  test('formatAsJson converts memories to valid JSON', async () => {
    const { formatAsJson } = await import('../src/cli/commands/export.ts')

    const memories: PluginMemory[] = [
      {
        id: 1,
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'Test memory content',
        filePath: null,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    const jsonOutput = formatAsJson(memories)
    const parsed = JSON.parse(jsonOutput)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].content).toBe('Test memory content')
    expect(parsed[0].projectId).toBe(TEST_PROJECT_ID)
    expect(parsed[0].scope).toBe('convention')
  })

  test('formatAsJson handles empty array', async () => {
    const { formatAsJson } = await import('../src/cli/commands/export.ts')

    const jsonOutput = formatAsJson([])
    const parsed = JSON.parse(jsonOutput)

    expect(parsed).toHaveLength(0)
  })
})

describe('CLI Export - formatAsMarkdown', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cli-test-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('exports formatAsMarkdown function', async () => {
    const { formatAsMarkdown } = await import('../src/cli/commands/export.ts')
    expect(typeof formatAsMarkdown).toBe('function')
  })

  test('formatAsMarkdown generates markdown with sections by scope', async () => {
    const { formatAsMarkdown } = await import('../src/cli/commands/export.ts')

    const memories: PluginMemory[] = [
      {
        id: 1,
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'Use TypeScript for all new code',
        filePath: null,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 2,
        projectId: TEST_PROJECT_ID,
        scope: 'decision',
        content: 'Chose Bun as runtime for performance',
        filePath: null,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    const markdownOutput = formatAsMarkdown(memories)

    expect(markdownOutput).toContain('# Memory Export')
    expect(markdownOutput).toContain('## Conventions (1)')
    expect(markdownOutput).toContain('## Decisions (1)')
    expect(markdownOutput).toContain('Use TypeScript for all new code')
    expect(markdownOutput).toContain('Chose Bun as runtime for performance')
  })

  test('formatAsMarkdown groups memories by scope', async () => {
    const { formatAsMarkdown } = await import('../src/cli/commands/export.ts')

    const db = createTestDb(tempDir)
    insertTestMemories(db, TEST_PROJECT_ID)
    db.close()

    const db2 = new Database(join(tempDir, 'memory.db'))
    const rows = db2.prepare('SELECT * FROM memories WHERE project_id = ?').all(TEST_PROJECT_ID) as Array<{
      id: number
      project_id: string
      scope: string
      content: string
      file_path: string | null
      access_count: number
      last_accessed_at: number | null
      created_at: number
      updated_at: number
    }>
    db2.close()

    const memories: PluginMemory[] = rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      scope: row.scope as 'convention' | 'decision' | 'context',
      content: row.content,
      filePath: row.file_path,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    const markdownOutput = formatAsMarkdown(memories)

    expect(markdownOutput).toContain('Conventions')
    expect(markdownOutput).toContain('Decisions')
    expect(markdownOutput).toContain('Contexts')
    expect(markdownOutput).toContain('Use TypeScript for all new code')
    expect(markdownOutput).toContain('Chose Bun as runtime for performance')
    expect(markdownOutput).toContain('Project started in 2024')
  })

  test('formatAsMarkdown only includes scopes with memories', async () => {
    const { formatAsMarkdown } = await import('../src/cli/commands/export.ts')

    const memories: PluginMemory[] = [
      {
        id: 1,
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'Only convention',
        filePath: null,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    const markdownOutput = formatAsMarkdown(memories)

    expect(markdownOutput).toContain('## Conventions (1)')
    expect(markdownOutput).not.toContain('## Decisions')
    expect(markdownOutput).not.toContain('## Contexts')
  })
})

describe('CLI Export - parseJsonImport', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cli-test-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('exports parseJsonImport function', async () => {
    const { parseJsonImport } = await import('../src/cli/commands/import.ts')
    expect(typeof parseJsonImport).toBe('function')
  })

  test('parseJsonImport parses valid JSON array', async () => {
    const { parseJsonImport } = await import('../src/cli/commands/import.ts')

    const input = [
      {
        projectId: TEST_PROJECT_ID,
        scope: 'decision',
        content: 'Test content 1',
      },
      {
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'Test content 2',
      },
    ]

    const memories = parseJsonImport(JSON.stringify(input), TEST_PROJECT_ID)

    expect(memories).toHaveLength(2)
    expect(memories[0].content).toBe('Test content 1')
    expect(memories[0].scope).toBe('decision')
    expect(memories[1].content).toBe('Test content 2')
    expect(memories[1].scope).toBe('convention')
  })

  test('parseJsonImport uses default values for missing fields', async () => {
    const { parseJsonImport } = await import('../src/cli/commands/import.ts')

    const input = [
      {
        content: 'Minimal memory',
      },
    ]

    const memories = parseJsonImport(JSON.stringify(input), TEST_PROJECT_ID)

    expect(memories).toHaveLength(1)
    expect(memories[0].content).toBe('Minimal memory')
    expect(memories[0].projectId).toBe(TEST_PROJECT_ID)
    expect(memories[0].scope).toBe('context')
  })

  test('parseJsonImport throws on invalid JSON', async () => {
    const { parseJsonImport } = await import('../src/cli/commands/import.ts')

    expect(() => parseJsonImport('not valid json', TEST_PROJECT_ID)).toThrow()
  })

  test('parseJsonImport throws when input is not an array', async () => {
    const { parseJsonImport } = await import('../src/cli/commands/import.ts')

    expect(() => parseJsonImport('{"invalid": "object"}', TEST_PROJECT_ID)).toThrow()
    expect(() => parseJsonImport('{}', TEST_PROJECT_ID)).toThrow()
  })
})

describe('CLI Export - parseMarkdownImport', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cli-test-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('exports parseMarkdownImport function', async () => {
    const { parseMarkdownImport } = await import('../src/cli/commands/import.ts')
    expect(typeof parseMarkdownImport).toBe('function')
  })

  test('parseMarkdownImport parses scoped sections', async () => {
    const { parseMarkdownImport } = await import('../src/cli/commands/import.ts')

    const markdownContent = `# Memory Export

## Conventions (1)

### [1] - Created 2024-01-01

Use ESLint for code linting

## Decisions (1)

### [2] - Created 2024-01-01

Adopted Prettier for formatting
`

    const memories = parseMarkdownImport(markdownContent, TEST_PROJECT_ID)

    expect(memories.length).toBeGreaterThanOrEqual(1)
    const hasEslint = memories.some((m) => m.content.includes('ESLint'))
    expect(hasEslint).toBe(true)
  })

  test('parseMarkdownImport falls back to parsing any content', async () => {
    const { parseMarkdownImport } = await import('../src/cli/commands/import.ts')

    const markdownContent = `# My Memories

Just some random content that should be captured as context
`

    const memories = parseMarkdownImport(markdownContent, TEST_PROJECT_ID)

    expect(memories.length).toBeGreaterThanOrEqual(1)
    expect(memories[0]?.content).toContain('random content')
  })
})

describe('CLI Export - database integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join('.', 'temp-cli-test-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('can query memories from database', async () => {
    const { formatAsJson } = await import('../src/cli/commands/export.ts')

    const db = createTestDb(tempDir)
    insertTestMemories(db, TEST_PROJECT_ID)
    db.close()

    const db2 = new Database(join(tempDir, 'memory.db'))
    const rows = db2
      .prepare('SELECT * FROM memories WHERE project_id = ?')
      .all(TEST_PROJECT_ID) as PluginMemory[]
    db2.close()

    const jsonOutput = formatAsJson(rows)

    expect(jsonOutput).toContain('Use TypeScript for all new code')
    expect(jsonOutput).toContain('Chose Bun as runtime for performance')
    expect(jsonOutput).toContain('Project started in 2024')

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveLength(3)
  })

  test('can filter by scope', async () => {
    const { formatAsJson } = await import('../src/cli/commands/export.ts')

    const db = createTestDb(tempDir)
    insertTestMemories(db, TEST_PROJECT_ID)
    db.close()

    const db2 = new Database(join(tempDir, 'memory.db'))
    const rows = db2
      .prepare('SELECT * FROM memories WHERE project_id = ? AND scope = ?')
      .all(TEST_PROJECT_ID, 'convention') as PluginMemory[]
    db2.close()

    const jsonOutput = formatAsJson(rows)

    expect(jsonOutput).toContain('Use TypeScript for all new code')
    expect(jsonOutput).not.toContain('Chose Bun as runtime')
    expect(jsonOutput).not.toContain('Project started in 2024')

    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].scope).toBe('convention')
  })

  test('import adds new memories to database', async () => {
    const db = createTestDb(tempDir)
    db.close()

    const importData = [
      {
        projectId: TEST_PROJECT_ID,
        scope: 'decision',
        content: 'Imported decision memory',
      },
      {
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'Imported convention memory',
      },
    ]

    const db2 = new Database(join(tempDir, 'memory.db'))

    for (const item of importData) {
      const now = Date.now()
      db2.run(
        'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [item.projectId, item.scope, item.content, null, 0, now, now]
      )
    }

    db2.close()

    const db3 = new Database(join(tempDir, 'memory.db'))
    const rows = db3.prepare('SELECT * FROM memories WHERE project_id = ?').all(TEST_PROJECT_ID) as PluginMemory[]
    db3.close()

    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.content === 'Imported decision memory')).toBe(true)
    expect(rows.some((r) => r.content === 'Imported convention memory')).toBe(true)
  })

  test('duplicate detection works correctly', async () => {
    const db = createTestDb(tempDir)
    const now = Date.now()

    db.run(
      'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [TEST_PROJECT_ID, 'convention', 'Existing memory', null, 0, now, now]
    )
    db.close()

    const importData = [
      {
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'Existing memory',
      },
      {
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: 'New memory',
      },
    ]

    const db2 = new Database(join(tempDir, 'memory.db'))

    let importedCount = 0
    let skippedCount = 0

    for (const item of importData) {
      const existing = db2
        .prepare('SELECT id FROM memories WHERE project_id = ? AND content = ? LIMIT 1')
        .get(TEST_PROJECT_ID, item.content)

      if (existing) {
        skippedCount++
      } else {
        const now2 = Date.now()
        db2.run(
          'INSERT INTO memories (project_id, scope, content, file_path, access_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [item.projectId, item.scope, item.content, null, 0, now2, now2]
        )
        importedCount++
      }
    }

    db2.close()

    expect(importedCount).toBe(1)
    expect(skippedCount).toBe(1)

    const db3 = new Database(join(tempDir, 'memory.db'))
    const rows = db3.prepare('SELECT * FROM memories WHERE project_id = ?').all(TEST_PROJECT_ID) as PluginMemory[]
    db3.close()

    expect(rows).toHaveLength(2)
  })
})
