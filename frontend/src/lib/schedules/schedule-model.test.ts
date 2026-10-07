import { describe, it, expect } from 'vitest'
import { resolveScheduleModel } from './schedule-model'
import type { ModelInfo } from '@opencode-manager/shared/opencode'

function model(providerID: string, id: string): ModelInfo {
  return { providerID, id } as unknown as ModelInfo
}

describe('resolveScheduleModel', () => {
  const models: ModelInfo[] = [model('openai', 'gpt-5'), model('openai', 'gpt-5-mini')]

  it('keeps a stored model that is still available', () => {
    expect(resolveScheduleModel('openai/gpt-5-mini', models)).toBe('openai/gpt-5-mini')
  })

  it('keeps a stored model with a variant suffix', () => {
    expect(resolveScheduleModel('openai/gpt-5#high', models)).toBe('openai/gpt-5#high')
  })

  it('drops a stored model that is no longer available without a fallback', () => {
    expect(resolveScheduleModel('openai/retired', models)).toBeNull()
  })

  it('drops a stored model that matches only the backing model id', () => {
    expect(resolveScheduleModel('openai/gpt-5-2025-08-07', models)).toBeNull()
  })

  it('treats an empty stored model as the workspace default', () => {
    expect(resolveScheduleModel('', models)).toBeNull()
    expect(resolveScheduleModel('   ', models)).toBeNull()
    expect(resolveScheduleModel(null, models)).toBeNull()
  })

  it('keeps the stored model while availability is unknown', () => {
    expect(resolveScheduleModel('openai/retired', null)).toBe('openai/retired')
  })

  it('keeps the stored model when the catalog is empty', () => {
    expect(resolveScheduleModel('openai/retired', [])).toBe('openai/retired')
  })
})
