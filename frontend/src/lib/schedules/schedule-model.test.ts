import { describe, it, expect } from 'vitest'
import {
  buildAvailableModelKeys,
  getConfigDefaultModel,
  resolveScheduleModel,
} from './schedule-model'
import type { ProviderWithModels } from '@/api/providers'
import type { OpenCodeConfigFile } from '@/api/types/settings'

function makeProvider(id: string, models: Array<{ id: string; key?: string }>): ProviderWithModels {
  return {
    id,
    name: id,
    env: [],
    models: models.map((model) => ({ ...model, name: model.key ?? model.id })),
    source: 'builtin',
    isConnected: true,
  }
}

function makeConfigFile(content: Record<string, unknown>): OpenCodeConfigFile {
  return {
    path: '/workspace/.config/opencode/opencode.json',
    content,
    rawContent: JSON.stringify(content),
    isValid: true,
    updatedAt: 0,
  }
}

describe('buildAvailableModelKeys', () => {
  it('collects provider/model keys and backing model ids', () => {
    const keys = buildAvailableModelKeys([
      makeProvider('openai', [{ id: 'backing-gpt-5', key: 'gpt-5' }]),
      makeProvider('anthropic', [{ id: 'claude-sonnet-4' }]),
    ])

    expect(keys).toEqual(new Set([
      'openai/gpt-5',
      'openai/backing-gpt-5',
      'anthropic/claude-sonnet-4',
    ]))
  })
})

describe('getConfigDefaultModel', () => {
  it('returns the configured model, trimmed, and ignores small_model', () => {
    expect(getConfigDefaultModel(makeConfigFile({
      model: ' openai/gpt-5 ',
      small_model: 'openai/gpt-5-mini',
    }))).toBe('openai/gpt-5')
  })

  it('returns null when the model is missing or unset', () => {
    expect(getConfigDefaultModel(undefined)).toBeNull()
    expect(getConfigDefaultModel(makeConfigFile({}))).toBeNull()
    expect(getConfigDefaultModel(makeConfigFile({ model: 42 }))).toBeNull()
  })
})

describe('resolveScheduleModel', () => {
  const available = new Set(['openai/gpt-5', 'openai/gpt-5-mini'])

  it('keeps a stored model that is still available', () => {
    expect(resolveScheduleModel('openai/gpt-5-mini', available, 'openai/gpt-5')).toBe('openai/gpt-5-mini')
  })

  it('falls back to the config default when the stored model is gone', () => {
    expect(resolveScheduleModel('openai/retired', available, 'openai/gpt-5')).toBe('openai/gpt-5')
  })

  it('returns null when neither the stored model nor the config default is available', () => {
    expect(resolveScheduleModel('openai/retired', available, 'openai/also-retired')).toBeNull()
  })

  it('treats an empty stored model as the workspace default', () => {
    expect(resolveScheduleModel('', available, 'openai/gpt-5')).toBeNull()
    expect(resolveScheduleModel(null, available, 'openai/gpt-5')).toBeNull()
  })

  it('keeps the stored model while availability is unknown', () => {
    expect(resolveScheduleModel('openai/retired', null, 'openai/gpt-5')).toBe('openai/retired')
  })

  it('drops the stored model when availability is confirmed empty', () => {
    expect(resolveScheduleModel('openai/retired', new Set(), 'openai/gpt-5')).toBeNull()
  })
})
