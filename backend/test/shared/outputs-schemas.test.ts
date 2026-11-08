import { describe, expect, it } from 'vitest'
import {
  OutputDefinitionSchema,
  OutputFrameMessageSchema,
  OutputHostMessageSchema,
  WALKTHROUGH_OUTPUT_DEFINITION,
  validateOutputData,
} from '@opencode-manager/shared/schemas'

const validPublishData = {
  title: 'Add output definitions',
  summary: 'Introduces shared schemas for output definitions.',
  stops: [
    {
      id: 'stop-1',
      title: 'Schemas',
      explanation: 'Defines the shared contracts.',
      hunkIds: ['hunk-1'],
    },
  ],
}

function nestedObjectSchema(depth: number): unknown {
  let schema: unknown = { type: 'string' }
  for (let index = 0; index < depth - 1; index += 1) {
    schema = { type: 'object', properties: { child: schema } }
  }
  return schema
}

describe('OutputDefinitionSchema', () => {
  it('parses the builtin walkthrough definition', () => {
    expect(OutputDefinitionSchema.parse(WALKTHROUGH_OUTPUT_DEFINITION)).toEqual(WALKTHROUGH_OUTPUT_DEFINITION)
  })

  it('rejects a builtin renderer without a builtin origin', () => {
    expect(
      OutputDefinitionSchema.safeParse({ ...WALKTHROUGH_OUTPUT_DEFINITION, origin: 'global' }).success,
    ).toBe(false)
  })

  it('rejects the changes provider without a changeSource parameter', () => {
    expect(OutputDefinitionSchema.safeParse({ ...WALKTHROUGH_OUTPUT_DEFINITION, params: [] }).success).toBe(
      false,
    )
  })

  it('rejects a data schema with an unknown keyword', () => {
    expect(
      OutputDefinitionSchema.safeParse({
        ...WALKTHROUGH_OUTPUT_DEFINITION,
        dataSchema: { type: 'string', pattern: '^a' },
      }).success,
    ).toBe(false)
  })

  it('rejects a data schema nested deeper than the limit', () => {
    const result = OutputDefinitionSchema.safeParse({
      ...WALKTHROUGH_OUTPUT_DEFINITION,
      dataSchema: nestedObjectSchema(9),
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message.includes('depth'))).toBe(true)
  })

  it('rejects a data schema over 32 KiB', () => {
    const result = OutputDefinitionSchema.safeParse({
      ...WALKTHROUGH_OUTPUT_DEFINITION,
      dataSchema: { type: 'string', description: 'a'.repeat(40000) },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message.includes('32 KiB'))).toBe(true)
  })
})

describe('validateOutputData', () => {
  const dataSchema = WALKTHROUGH_OUTPUT_DEFINITION.dataSchema!

  it('accepts valid walkthrough data', () => {
    const result = validateOutputData(dataSchema, validPublishData)

    expect(result.ok).toBe(true)
  })

  it('rejects data without stops', () => {
    const withoutStops = Object.fromEntries(
      Object.entries(validPublishData).filter(([key]) => key !== 'stops'),
    )
    const result = validateOutputData(dataSchema, withoutStops)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('stops')
  })

  it('rejects an extra unknown property', () => {
    const result = validateOutputData(dataSchema, { ...validPublishData, extra: true })

    expect(result.ok).toBe(false)
  })

  it('rejects data over the 1 MiB limit', () => {
    const result = validateOutputData({ type: 'string' }, 'a'.repeat(1024 * 1024))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('1 MiB')
  })
})

describe('OutputHostMessageSchema', () => {
  it('accepts valid host messages', () => {
    expect(
      OutputHostMessageSchema.safeParse({ type: 'ui/initialize', data: {}, theme: { mode: 'dark' } }).success,
    ).toBe(true)
    expect(OutputHostMessageSchema.safeParse({ type: 'ui/data', data: [] }).success).toBe(true)
  })

  it('rejects an unknown type', () => {
    expect(OutputHostMessageSchema.safeParse({ type: 'ui/unknown', data: {} }).success).toBe(false)
  })
})

describe('OutputFrameMessageSchema', () => {
  it('accepts valid frame messages', () => {
    expect(OutputFrameMessageSchema.safeParse({ type: 'ui/size', height: 320 }).success).toBe(true)
    expect(OutputFrameMessageSchema.safeParse({ type: 'ui/open-file', path: 'src/a.ts', line: 3 }).success).toBe(
      true,
    )
    expect(OutputFrameMessageSchema.safeParse({ type: 'ui/refine', text: 'Tighten the summary' }).success).toBe(
      true,
    )
  })

  it('rejects an unknown type', () => {
    expect(OutputFrameMessageSchema.safeParse({ type: 'ui/unknown', height: 320 }).success).toBe(false)
  })

  it('rejects a negative height', () => {
    expect(OutputFrameMessageSchema.safeParse({ type: 'ui/size', height: -1 }).success).toBe(false)
  })

  it('rejects an empty path', () => {
    expect(OutputFrameMessageSchema.safeParse({ type: 'ui/open-file', path: '' }).success).toBe(false)
  })
})
