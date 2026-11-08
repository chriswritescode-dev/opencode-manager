import type { Database } from 'bun:sqlite'
import {
  BUILTIN_OUTPUT_DEFINITIONS,
  OutputDefinitionSchema,
  isBuiltinOutputDefinitionId,
  type OutputDefinition,
  type OutputDefinitionInput,
  type PromoteOutputDefinitionRequest,
} from '@opencode-manager/shared/schemas'
import {
  deleteOutputDefinition,
  getOutputDefinitionRow,
  hasGeneratingOutput,
  insertOutputDefinition,
  listOutputDefinitionRows,
  promoteSessionOutputDefinition,
  upsertOutputDefinition,
} from '../../db/outputs'
import { OutputError } from './output-error'

type OutputDefinitionOrigin = 'global' | 'session'

interface RendererKindInput {
  renderer?: { kind?: unknown }
}

function usesBuiltinRenderer(input: RendererKindInput): boolean {
  return input.renderer?.kind === 'builtin'
}

export class OutputDefinitionRegistry {
  constructor(private db: Database) {}

  list(sessionId?: string): OutputDefinition[] {
    const stored = listOutputDefinitionRows(this.db, sessionId)
    const sessionDefinitions = stored.filter((definition) => definition.origin === 'session')
    const globalDefinitions = stored.filter((definition) => definition.origin === 'global')
    const seen = new Set<string>()
    const definitions: OutputDefinition[] = []
    for (const definition of [...BUILTIN_OUTPUT_DEFINITIONS, ...sessionDefinitions, ...globalDefinitions]) {
      if (seen.has(definition.id)) {
        continue
      }
      seen.add(definition.id)
      definitions.push(definition)
    }
    return definitions
  }

  get(sessionId: string, id: string): OutputDefinition {
    const builtin = BUILTIN_OUTPUT_DEFINITIONS.find((definition) => definition.id === id)
    if (builtin) {
      return builtin
    }
    const definition = getOutputDefinitionRow(this.db, sessionId, id) ?? getOutputDefinitionRow(this.db, '', id)
    if (!definition) {
      throw new OutputError(`Output definition "${id}" not found`, 404, {
        code: 'OUTPUT_DEFINITION_NOT_FOUND',
      })
    }
    return definition
  }

  createGlobal(input: OutputDefinitionInput): OutputDefinition {
    this.assertUserDefinition(input.id, input)
    const definition = this.parseDefinition(input, 'global')
    if (!insertOutputDefinition(this.db, { sessionId: '', definition, now: Date.now() })) {
      throw new OutputError(`Output definition "${input.id}" already exists`, 409, {
        code: 'OUTPUT_DEFINITION_EXISTS',
      })
    }
    return definition
  }

  putGlobal(id: string, input: OutputDefinitionInput): OutputDefinition {
    this.assertUserDefinition(id, input)
    if (input.id !== id) {
      throw new OutputError(`Output definition id must be "${id}"`, 400, {
        code: 'OUTPUT_DEFINITION_INVALID',
      })
    }
    const definition = this.parseDefinition(input, 'global')
    this.assertNotGenerating(id)
    upsertOutputDefinition(this.db, { sessionId: '', definition, now: Date.now() })
    return definition
  }

  deleteGlobal(id: string): void {
    this.assertUserDefinition(id)
    if (!getOutputDefinitionRow(this.db, '', id)) {
      throw new OutputError(`Output definition "${id}" not found`, 404, {
        code: 'OUTPUT_DEFINITION_NOT_FOUND',
      })
    }
    this.assertNotGenerating(id)
    deleteOutputDefinition(this.db, '', id)
  }

  defineSession(sessionId: string, input: OutputDefinitionInput): OutputDefinition {
    this.assertUserDefinition(input.id, input)
    const definition = this.parseDefinition(input, 'session')
    upsertOutputDefinition(this.db, { sessionId, definition, now: Date.now() })
    return definition
  }

  promote(input: PromoteOutputDefinitionRequest): OutputDefinition {
    this.assertUserDefinition(input.id)
    const stored = getOutputDefinitionRow(this.db, input.sessionId, input.id)
    if (!stored) {
      throw new OutputError(`Output definition "${input.id}" not found`, 404, {
        code: 'OUTPUT_DEFINITION_NOT_FOUND',
      })
    }
    const promoted = promoteSessionOutputDefinition(this.db, {
      sessionId: input.sessionId,
      id: input.id,
      definition: stored,
      replace: input.replace,
      now: Date.now(),
    })
    if (!promoted) {
      throw new OutputError(`Output definition "${input.id}" already exists`, 409, {
        code: 'OUTPUT_DEFINITION_EXISTS',
      })
    }
    return { ...stored, origin: 'global' }
  }

  private assertNotGenerating(id: string): void {
    if (hasGeneratingOutput(this.db, id)) {
      throw new OutputError('An output of this definition is still generating', 409, {
        code: 'OUTPUT_DEFINITION_IN_USE',
      })
    }
  }

  private assertUserDefinition(id: string, input?: RendererKindInput): void {
    if (isBuiltinOutputDefinitionId(id)) {
      throw new OutputError(`Output definition id "${id}" is reserved`, 400, {
        code: 'OUTPUT_DEFINITION_RESERVED',
      })
    }
    if (input && usesBuiltinRenderer(input)) {
      throw new OutputError('Builtin renderers are reserved for builtin definitions', 400, {
        code: 'OUTPUT_DEFINITION_INVALID',
      })
    }
  }

  private parseDefinition(input: OutputDefinitionInput, origin: OutputDefinitionOrigin): OutputDefinition {
    const parsed = OutputDefinitionSchema.safeParse({ ...input, origin })
    if (!parsed.success) {
      throw new OutputError(parsed.error.issues[0]?.message || 'Invalid output definition', 400, {
        code: 'OUTPUT_DEFINITION_INVALID',
        details: parsed.error.issues,
      })
    }
    return parsed.data
  }
}
