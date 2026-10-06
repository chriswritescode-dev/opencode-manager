import { describe, it, expect } from 'vitest'
import {
  buildAvailableModelKeys,
  buildScheduleModelOptions,
  resolveScheduleModel,
} from './schedule-model'
import type { ProviderWithModels } from '@/api/providers'

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

describe('buildScheduleModelOptions', () => {
  const providers = [
    makeProvider('anthropic', [{ id: 'claude-opus' }, { id: 'claude-sonnet' }]),
    makeProvider('openai', [{ id: 'backing-gpt-5', key: 'gpt-5' }, { id: 'gpt-5-mini' }]),
  ]

  it('orders default, favorites, and recents ahead of providers without duplicates', () => {
    const options = buildScheduleModelOptions(
      providers,
      {
        favorite: [{ providerID: 'openai', modelID: 'gpt-5-mini' }],
        recent: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }, { providerID: 'openai', modelID: 'gpt-5' }],
        variant: {},
      },
      'openai/backing-gpt-5',
    )

    expect(options.map((option) => [option.group, option.value])).toEqual([
      ['Default', 'openai/backing-gpt-5'],
      ['Favorites', 'openai/gpt-5-mini'],
      ['Recent', 'anthropic/claude-sonnet'],
      ['anthropic', 'anthropic/claude-opus'],
    ])
  })

  it('keeps an unknown default model selectable', () => {
    const options = buildScheduleModelOptions(providers, undefined, 'custom/model-x')
    expect(options[0]).toEqual({ value: 'custom/model-x', label: 'model-x', description: 'custom/model-x', group: 'Default' })
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
