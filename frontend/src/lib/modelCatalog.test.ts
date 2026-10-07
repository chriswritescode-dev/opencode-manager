import { describe, it, expect } from 'vitest'
import { isModelAvailable } from './modelCatalog'
import type { ModelInfo } from '@opencode-manager/shared/opencode'

const models = [
  { providerID: 'openai', id: 'gpt-5' },
  { providerID: 'anthropic', id: 'claude-sonnet-4-20250514' },
] as unknown as ModelInfo[]

describe('isModelAvailable', () => {
  it('accepts a selection that matches the OpenCode key', () => {
    expect(isModelAvailable(models, { providerID: 'openai', modelID: 'gpt-5' })).toBe(true)
  })

  it('rejects a selection that matches only the backing model id', () => {
    expect(isModelAvailable(models, { providerID: 'openai', modelID: 'gpt-5-2025-08-07' })).toBe(false)
  })

  it('accepts a string ref that matches the OpenCode key', () => {
    expect(isModelAvailable(models, 'openai/gpt-5')).toBe(true)
  })

  it('accepts a string ref with a variant suffix', () => {
    expect(isModelAvailable(models, 'openai/gpt-5#high')).toBe(true)
  })

  it('rejects a string ref that matches only the backing model id', () => {
    expect(isModelAvailable(models, 'openai/gpt-5-2025-08-07')).toBe(false)
  })

  it('rejects an unknown provider', () => {
    expect(isModelAvailable(models, { providerID: 'ghost', modelID: 'gpt-5' })).toBe(false)
  })

  it('rejects an unknown model', () => {
    expect(isModelAvailable(models, { providerID: 'openai', modelID: 'missing' })).toBe(false)
  })

  it('rejects an unparsable string ref', () => {
    expect(isModelAvailable(models, 'gpt-5')).toBe(false)
    expect(isModelAvailable(models, '')).toBe(false)
  })

  it('rejects a null ref', () => {
    expect(isModelAvailable(models, null)).toBe(false)
  })

  it('rejects every ref when the catalog is empty', () => {
    expect(isModelAvailable([], { providerID: 'openai', modelID: 'gpt-5' })).toBe(false)
    expect(isModelAvailable([], 'openai/gpt-5')).toBe(false)
  })
})
