import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import {
  WALKTHROUGH_OUTPUT_DEFINITION,
  type OutputDefinitionInput,
} from '@opencode-manager/shared/schemas'
import { getOutputDefinitionRow, insertOutputDefinition } from '../../../src/db/outputs'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { OutputDefinitionRegistry } from '../../../src/services/outputs/definition-registry'
import { OutputError } from '../../../src/services/outputs/output-error'

const SESSION_ID = 'ses_a'
const OTHER_SESSION_ID = 'ses_b'
const DEFINITION_ID = 'report'

function definitionInput(overrides: Partial<OutputDefinitionInput> = {}): OutputDefinitionInput {
  return {
    id: DEFINITION_ID,
    label: 'Report',
    description: '',
    icon: 'FileText',
    params: [],
    instructions: 'Write a report.',
    dataSchema: { type: 'object', properties: { total: { type: 'number' } } },
    renderer: { kind: 'template', html: '<p>{{total}}</p>' },
    generation: 'separateSession',
    ...overrides,
  }
}

function captureError(run: () => unknown): OutputError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(OutputError)
    return error as OutputError
  }
  throw new Error('Expected an OutputError')
}

describe('OutputDefinitionRegistry', () => {
  let db: Database
  let registry: OutputDefinitionRegistry

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    registry = new OutputDefinitionRegistry(db)
  })

  afterEach(() => {
    db.close()
  })

  it('lists the built-in definitions and resolves one by id', () => {
    const definitions = registry.list()

    expect(definitions[0]).toEqual(WALKTHROUGH_OUTPUT_DEFINITION)
    expect(registry.get(SESSION_ID, 'walkthrough')).toEqual(WALKTHROUGH_OUTPUT_DEFINITION)
  })

  it('creates a global definition and rejects a duplicate', () => {
    const created = registry.createGlobal(definitionInput())

    expect(created).toMatchObject({ id: DEFINITION_ID, label: 'Report', origin: 'global' })
    expect(registry.list().map((definition) => definition.id)).toContain(DEFINITION_ID)

    const error = captureError(() => registry.createGlobal(definitionInput({ label: 'Duplicate' })))

    expect(error.status).toBe(409)
    expect(error.code).toBe('OUTPUT_DEFINITION_EXISTS')
    expect(registry.get(SESSION_ID, DEFINITION_ID)).toMatchObject({ label: 'Report', origin: 'global' })
  })

  it('upserts a global definition and rejects a body id that differs from the path id', () => {
    const created = registry.putGlobal(DEFINITION_ID, definitionInput())
    expect(created.origin).toBe('global')

    const replaced = registry.putGlobal(DEFINITION_ID, definitionInput({ label: 'Updated' }))
    expect(replaced).toMatchObject({ id: DEFINITION_ID, label: 'Updated', origin: 'global' })
    expect(registry.get(SESSION_ID, DEFINITION_ID)?.label).toBe('Updated')

    const error = captureError(() => registry.putGlobal(DEFINITION_ID, definitionInput({ id: 'other' })))
    expect(error.status).toBe(400)
    expect(error.code).toBe('OUTPUT_DEFINITION_INVALID')
  })

  it('scopes a session definition to its own session', () => {
    registry.defineSession(SESSION_ID, definitionInput())

    expect(registry.list(SESSION_ID).map((definition) => definition.id)).toContain(DEFINITION_ID)
    expect(registry.list(OTHER_SESSION_ID).map((definition) => definition.id)).not.toContain(DEFINITION_ID)
    expect(registry.list().map((definition) => definition.id)).not.toContain(DEFINITION_ID)
    expect(registry.get(SESSION_ID, DEFINITION_ID).origin).toBe('session')
  })

  it('orders built-ins, session definitions, then globals and deduplicates built-in ids', () => {
    registry.defineSession(SESSION_ID, definitionInput({ id: 'session-def' }))
    registry.createGlobal(definitionInput({ id: 'global-def' }))
    insertOutputDefinition(db, {
      sessionId: '',
      definition: definitionInput({ id: 'walkthrough' }),
      now: Date.now(),
    })

    const definitions = registry.list(SESSION_ID)
    const ids = definitions.map((definition) => definition.id)

    expect(ids.indexOf('walkthrough')).toBeLessThan(ids.indexOf('session-def'))
    expect(ids.indexOf('session-def')).toBeLessThan(ids.indexOf('global-def'))
    expect(definitions.filter((definition) => definition.id === 'walkthrough')).toHaveLength(1)
    expect(definitions.find((definition) => definition.id === 'walkthrough')?.origin).toBe('builtin')
  })

  it('rejects built-in ids for every mutation', () => {
    const builtinInput = definitionInput({ id: 'walkthrough' })
    const cases = [
      () => registry.createGlobal(builtinInput),
      () => registry.putGlobal('walkthrough', builtinInput),
      () => registry.defineSession(SESSION_ID, builtinInput),
      () => registry.deleteGlobal('walkthrough'),
      () => registry.promote({ sessionId: SESSION_ID, id: 'walkthrough' }),
    ]

    for (const run of cases) {
      const error = captureError(run)
      expect(error.status).toBe(400)
      expect(error.code).toBe('OUTPUT_DEFINITION_RESERVED')
    }
  })

  it('rejects a built-in renderer', () => {
    const error = captureError(() =>
      registry.createGlobal(definitionInput({ renderer: { kind: 'builtin', id: 'walkthrough' } })),
    )

    expect(error.status).toBe(400)
    expect(error.code).toBe('OUTPUT_DEFINITION_INVALID')
  })

  it('rejects an invalid definition with a message', () => {
    const missingSchema = captureError(() => registry.createGlobal(definitionInput({ dataSchema: undefined })))
    expect(missingSchema.status).toBe(400)
    expect(missingSchema.code).toBe('OUTPUT_DEFINITION_INVALID')
    expect(missingSchema.message.length).toBeGreaterThan(0)

    const badId = captureError(() => registry.createGlobal(definitionInput({ id: 'Bad Id' })))
    expect(badId.status).toBe(400)
    expect(badId.code).toBe('OUTPUT_DEFINITION_INVALID')
    expect(badId.message.length).toBeGreaterThan(0)
  })

  it('returns not found for missing definitions', () => {
    const getError = captureError(() => registry.get(SESSION_ID, 'missing'))
    expect(getError.status).toBe(404)
    expect(getError.code).toBe('OUTPUT_DEFINITION_NOT_FOUND')

    const deleteError = captureError(() => registry.deleteGlobal('missing'))
    expect(deleteError.status).toBe(404)
    expect(deleteError.code).toBe('OUTPUT_DEFINITION_NOT_FOUND')

    const promoteError = captureError(() => registry.promote({ sessionId: SESSION_ID, id: 'missing' }))
    expect(promoteError.status).toBe(404)
    expect(promoteError.code).toBe('OUTPUT_DEFINITION_NOT_FOUND')
  })

  it('promotes a session definition over an existing global with replace', () => {
    registry.defineSession(SESSION_ID, definitionInput({ label: 'Session report' }))
    registry.createGlobal(definitionInput({ label: 'Global report' }))

    const conflict = captureError(() => registry.promote({ sessionId: SESSION_ID, id: DEFINITION_ID }))
    expect(conflict.status).toBe(409)
    expect(conflict.code).toBe('OUTPUT_DEFINITION_EXISTS')
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)).not.toBeNull()

    const promoted = registry.promote({ sessionId: SESSION_ID, id: DEFINITION_ID, replace: true })

    expect(promoted).toMatchObject({ id: DEFINITION_ID, label: 'Session report', origin: 'global' })
    expect(getOutputDefinitionRow(db, SESSION_ID, DEFINITION_ID)).toBeNull()
    expect(registry.list(OTHER_SESSION_ID)).toContainEqual(
      expect.objectContaining({ id: DEFINITION_ID, label: 'Session report', origin: 'global' }),
    )
  })
})
