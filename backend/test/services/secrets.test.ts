import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { selectRow } from '../../src/db/rows'
import { SecretsService, SecretsServiceError } from '../../src/services/secrets'
import { decryptSecret } from '../../src/utils/crypto'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { createTestDatabase } from '../helpers/test-database'
import { testLogEntries } from '../helpers/log-assertions'
import { catchThrownError } from '../helpers/thrown-error'

const StoredSecretRowSchema = z.object({ value: z.string() })

function readStoredValue(db: Database, name: string): string {
  return selectRow(db, StoredSecretRowSchema, 'SELECT value FROM secrets WHERE name = ?', name)?.value ?? ''
}

describe('SecretsService', () => {
  let db: Database
  let service: SecretsService

  beforeEach(() => {
    db = createTestDatabase()
    service = new SecretsService(db)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('stores secret values encrypted at rest and decrypts them on resolve', () => {
    service.set('secret', null, null, 'TOKEN', 'super-secret')

    const stored = readStoredValue(db, 'TOKEN')
    expect(stored).not.toBe('super-secret')
    expect(decryptSecret(stored)).toBe('super-secret')

    expect(service.resolveValues(1, null).secrets.TOKEN).toBe('super-secret')
  })

  it('stores variable values in plain text', () => {
    service.set('variable', null, null, 'LOG_LEVEL', 'debug')

    expect(readStoredValue(db, 'LOG_LEVEL')).toBe('debug')
    expect(service.resolveValues(1, null).vars.LOG_LEVEL).toBe('debug')
  })

  it('omits secret values from list but includes variable values', () => {
    service.set('secret', null, null, 'TOKEN', 'super-secret')
    service.set('variable', null, null, 'LOG_LEVEL', 'debug')

    const secrets = service.list('secret', null)
    expect(secrets).toHaveLength(1)
    expect(secrets[0]).not.toHaveProperty('value')

    const variables = service.list('variable', null)
    expect(variables).toHaveLength(1)
    expect(variables[0]?.value).toBe('debug')
  })

  it('upserts an existing entry and refreshes updatedAt', () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1000)
    service.set('variable', null, null, 'LOG_LEVEL', 'info')

    nowSpy.mockReturnValueOnce(2000)
    service.set('variable', null, null, 'LOG_LEVEL', 'debug')

    const variables = service.list('variable', null)
    expect(variables).toHaveLength(1)
    expect(variables[0]?.value).toBe('debug')
    expect(variables[0]?.updatedAt).toBe(2000)
  })

  it('rejects an environment for a global entry', () => {
    const error = catchThrownError(() => service.set('secret', null, 'prod', 'TOKEN', 'value'))

    expect(error).toBeInstanceOf(SecretsServiceError)
    expect(error instanceof SecretsServiceError ? error.statusCode : null).toBe(400)
  })

  it('deletes an entry and reports whether it existed', () => {
    service.set('variable', null, null, 'LOG_LEVEL', 'debug')

    expect(service.delete('variable', null, null, 'LOG_LEVEL')).toBe(true)
    expect(service.delete('variable', null, null, 'LOG_LEVEL')).toBe(false)
    expect(service.list('variable', null)).toHaveLength(0)
  })

  it('lists a repository entries across all environments with empty environment mapped to null', () => {
    service.set('variable', 7, null, 'PLAIN', 'plain')
    service.set('variable', 7, 'prod', 'SCOPED', 'scoped')

    const variables = service.list('variable', 7)
    expect(variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'PLAIN', environment: null }),
        expect.objectContaining({ name: 'SCOPED', environment: 'prod' }),
      ]),
    )
  })

  it('keeps global and Assistant repository entries with the same name independent', () => {
    service.set('variable', null, null, 'LOG_LEVEL', 'global')
    service.set('variable', ASSISTANT_REPO_ID, null, 'LOG_LEVEL', 'assistant')

    expect(service.list('variable', null)).toEqual([
      expect.objectContaining({ name: 'LOG_LEVEL', value: 'global' }),
    ])
    expect(service.list('variable', ASSISTANT_REPO_ID)).toEqual([
      expect.objectContaining({ name: 'LOG_LEVEL', value: 'assistant' }),
    ])

    service.set('variable', null, null, 'LOG_LEVEL', 'global-updated')
    service.set('variable', ASSISTANT_REPO_ID, null, 'LOG_LEVEL', 'assistant-updated')

    expect(service.list('variable', null)[0]?.value).toBe('global-updated')
    expect(service.list('variable', ASSISTANT_REPO_ID)[0]?.value).toBe('assistant-updated')
  })

  it('resolves values with global < repository < repository+environment precedence', () => {
    service.set('secret', null, null, 'GLOBAL_ONLY', 'g')
    service.set('secret', 7, null, 'SHARED', 'repo')
    service.set('secret', 7, 'prod', 'SHARED', 'prod')
    service.set('variable', null, null, 'VAR_GLOBAL', 'vg')
    service.set('variable', 7, null, 'VAR_SHARED', 'vrepo')
    service.set('variable', 7, 'prod', 'VAR_SHARED', 'vprod')

    const production = service.resolveValues(7, 'prod')
    expect(production.secrets).toEqual({ GLOBAL_ONLY: 'g', SHARED: 'prod' })
    expect(production.vars).toEqual({ VAR_GLOBAL: 'vg', VAR_SHARED: 'vprod' })

    const withoutEnvironment = service.resolveValues(7, null)
    expect(withoutEnvironment.secrets).toEqual({ GLOBAL_ONLY: 'g', SHARED: 'repo' })
    expect(withoutEnvironment.vars).toEqual({ VAR_GLOBAL: 'vg', VAR_SHARED: 'vrepo' })

    const otherRepo = service.resolveValues(8, 'prod')
    expect(otherRepo.secrets).toEqual({ GLOBAL_ONLY: 'g' })
    expect(otherRepo.vars).toEqual({ VAR_GLOBAL: 'vg' })
  })

  it('skips a secret that cannot be decrypted and logs only its name', () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO secrets (kind, repo_id, environment, name, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('secret', null, '', 'BROKEN', 'not-a-valid-encrypted-value', now, now)

    const resolved = service.resolveValues(1, null)
    expect(resolved.secrets).not.toHaveProperty('BROKEN')

    const warnings = testLogEntries('warn')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('BROKEN')
    expect(warnings[0]?.message).not.toContain('not-a-valid-encrypted-value')
  })
})
