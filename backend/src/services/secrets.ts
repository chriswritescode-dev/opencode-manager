import type { Database } from 'bun:sqlite'
import type { SecretEntry, SecretKind } from '@opencode-manager/shared/schemas'
import { decryptSecret, encryptSecret } from '../utils/crypto'
import { logger } from '../utils/logger'

export class SecretsServiceError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message)
    this.name = 'SecretsServiceError'
  }
}

interface SecretRow {
  kind: SecretKind
  repo_id: number | null
  environment: string
  name: string
  value: string
  updated_at: number
}

type SecretValueRow = Omit<SecretRow, 'updated_at'>

export interface ResolvedSecretValues {
  secrets: Record<string, string>
  vars: Record<string, string>
}

export class SecretsService {
  constructor(private readonly db: Database) {}

  list(kind: SecretKind, repoId: number | null): SecretEntry[] {
    return this.selectRows(kind, repoId).map((row) => this.toEntry(kind, row))
  }

  set(kind: SecretKind, repoId: number | null, environment: string | null, name: string, value: string): void {
    const normalizedEnvironment = environment ?? ''
    if (repoId === null && normalizedEnvironment !== '') {
      throw new SecretsServiceError('Environments are only supported for repository secrets', 400)
    }

    const now = Date.now()
    const storedValue = kind === 'secret' ? encryptSecret(value) : value

    this.db
      .prepare(
        `INSERT INTO secrets (kind, repo_id, environment, name, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, COALESCE(repo_id, 0), environment, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(kind, repoId, normalizedEnvironment, name, storedValue, now, now)
  }

  delete(kind: SecretKind, repoId: number | null, environment: string | null, name: string): boolean {
    const result = this.db
      .prepare('DELETE FROM secrets WHERE kind = ? AND repo_id IS ? AND environment = ? AND name = ?')
      .run(kind, repoId, environment ?? '', name)

    return result.changes > 0
  }

  resolveValues(repoId: number, environment: string | null): ResolvedSecretValues {
    const rows = this.db
      .prepare(
        `SELECT kind, repo_id, environment, name, value FROM secrets
         WHERE repo_id IS NULL OR repo_id = ?
         ORDER BY CASE WHEN repo_id IS NULL THEN 0 WHEN environment = '' THEN 1 ELSE 2 END`,
      )
      .all(repoId) as SecretValueRow[]

    const secrets: Record<string, string> = {}
    const vars: Record<string, string> = {}

    for (const row of rows) {
      if (row.repo_id !== null && row.environment !== '' && row.environment !== environment) {
        continue
      }

      if (row.kind === 'secret') {
        try {
          secrets[row.name] = decryptSecret(row.value)
        } catch {
          logger.warn(`Skipping secret "${row.name}" because it could not be decrypted`)
        }
      } else {
        vars[row.name] = row.value
      }
    }

    return { secrets, vars }
  }

  private selectRows(kind: SecretKind, repoId: number | null): SecretRow[] {
    return this.db
      .prepare(
        'SELECT kind, repo_id, environment, name, value, updated_at FROM secrets WHERE kind = ? AND repo_id IS ? ORDER BY name',
      )
      .all(kind, repoId) as SecretRow[]
  }

  private toEntry(kind: SecretKind, row: SecretRow): SecretEntry {
    return {
      name: row.name,
      environment: row.environment === '' ? null : row.environment,
      updatedAt: row.updated_at,
      ...(kind === 'variable' ? { value: row.value } : {}),
    }
  }
}
