import { describe, it, expect } from 'vitest'
import { buildModelSections, filterModelSections, toModelComboboxOptions } from './modelSections'
import type { Model, Provider } from '@/api/providers'

function makeModel(id: string, overrides: Partial<Model> = {}): Model {
  return { id, key: id, name: id, released: 0, free: false, ...overrides }
}

function makeProvider(id: string, name: string, models: Model[]): Provider {
  return { id, name, models }
}

const providers = [
  makeProvider('openai', 'OpenAI', [
    makeModel('gpt-5', { name: 'GPT-5' }),
    makeModel('gpt-4o', { name: 'GPT-4o' }),
    makeModel('gpt-4o-mini', { name: 'GPT-4o mini' }),
  ]),
  makeProvider('anthropic', 'Anthropic', [
    makeModel('claude-opus', { name: 'Claude Opus' }),
    makeModel('claude-sonnet', { name: 'Claude Sonnet' }),
    makeModel('claude-haiku', { name: 'Claude Haiku' }),
  ]),
]

function valuesOf(sections: ReturnType<typeof buildModelSections>, key: string): string[] {
  return sections.find((section) => section.key === key)?.options.map((option) => option.value) ?? []
}

describe('buildModelSections', () => {
  it('orders default, favorites, recent, then providers', () => {
    const sections = buildModelSections(
      providers,
      {
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
        recent: [{ providerID: 'openai', modelID: 'gpt-4o' }],
        variant: {},
      },
      'openai/gpt-5',
    )

    expect(sections.map((section) => section.key)).toEqual([
      'default',
      'favorites',
      'recent',
      'provider:openai',
      'provider:anthropic',
    ])
    expect(valuesOf(sections, 'default')).toEqual(['openai/gpt-5'])
    expect(valuesOf(sections, 'favorites')).toEqual(['anthropic/claude-sonnet'])
    expect(valuesOf(sections, 'recent')).toEqual(['openai/gpt-4o'])
  })

  it('keeps the catalog order inside provider sections', () => {
    const sections = buildModelSections(providers, undefined)

    expect(valuesOf(sections, 'provider:openai')).toEqual(['openai/gpt-5', 'openai/gpt-4o', 'openai/gpt-4o-mini'])
    expect(valuesOf(sections, 'provider:anthropic')).toEqual([
      'anthropic/claude-opus',
      'anthropic/claude-sonnet',
      'anthropic/claude-haiku',
    ])
  })

  it('tags provider sections with their provider id', () => {
    const sections = buildModelSections(providers, undefined)

    expect(sections.find((section) => section.key === 'provider:openai')?.providerID).toBe('openai')
    expect(sections.find((section) => section.key === 'favorites')).toBeUndefined()
  })

  it('excludes favorites, recents and the default base model from provider sections', () => {
    const sections = buildModelSections(
      providers,
      {
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
        recent: [{ providerID: 'openai', modelID: 'gpt-4o' }],
        variant: {},
      },
      'openai/gpt-5',
    )

    const providerValues = sections
      .filter((section) => section.providerID)
      .flatMap((section) => section.options.map((option) => option.value))

    expect(providerValues).not.toContain('openai/gpt-5')
    expect(providerValues).not.toContain('openai/gpt-4o')
    expect(providerValues).not.toContain('anthropic/claude-sonnet')
    expect(providerValues).toEqual(['openai/gpt-4o-mini', 'anthropic/claude-opus', 'anthropic/claude-haiku'])
  })

  it('keeps the plain base model in provider sections when the default carries a variant', () => {
    const sections = buildModelSections(providers, undefined, 'openai/gpt-5#high')

    expect(valuesOf(sections, 'default')).toEqual(['openai/gpt-5#high'])
    expect(valuesOf(sections, 'provider:openai')).toContain('openai/gpt-5')
  })

  it('keeps a favorite in the favorites section when it is also the default model', () => {
    const sections = buildModelSections(
      providers,
      {
        favorite: [
          { providerID: 'openai', modelID: 'gpt-5' },
          { providerID: 'anthropic', modelID: 'claude-sonnet' },
        ],
        recent: [{ providerID: 'openai', modelID: 'gpt-5' }],
        variant: {},
      },
      'openai/gpt-5',
    )

    expect(valuesOf(sections, 'favorites')).toEqual(['openai/gpt-5', 'anthropic/claude-sonnet'])
    expect(valuesOf(sections, 'default')).toEqual(['openai/gpt-5'])
    expect(sections.some((section) => section.key === 'recent')).toBe(false)
    expect(valuesOf(sections, 'provider:openai')).not.toContain('openai/gpt-5')
  })

  it('lists each favorite once and excludes it from the recent section', () => {
    const sections = buildModelSections(providers, {
      favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
      recent: [
        { providerID: 'anthropic', modelID: 'claude-sonnet' },
        { providerID: 'openai', modelID: 'gpt-4o' },
      ],
      variant: {},
    })

    expect(valuesOf(sections, 'favorites')).toEqual(['anthropic/claude-sonnet'])
    expect(valuesOf(sections, 'recent')).toEqual(['openai/gpt-4o'])
  })

  it('drops favorites and recents that are not in the catalog', () => {
    const sections = buildModelSections(providers, {
      favorite: [{ providerID: 'missing', modelID: 'gone' }],
      recent: [{ providerID: 'openai', modelID: 'retired' }],
      variant: {},
    })

    expect(sections.some((section) => section.key === 'favorites')).toBe(false)
    expect(sections.some((section) => section.key === 'recent')).toBe(false)
  })

  it('keeps the full default ref including its variant', () => {
    const sections = buildModelSections(providers, undefined, 'openai/gpt-5#high')

    expect(sections[0].key).toBe('default')
    expect(sections[0].options[0].value).toBe('openai/gpt-5#high')
    expect(sections[0].options[0].label).toBe('GPT-5')
  })

  it('omits the default section when the model is not in the catalog', () => {
    expect(buildModelSections(providers, undefined, 'openai/retired').some((section) => section.key === 'default')).toBe(false)
    expect(buildModelSections(providers, undefined, 'not-a-ref').some((section) => section.key === 'default')).toBe(false)
    expect(buildModelSections(providers, undefined).some((section) => section.key === 'default')).toBe(false)
  })

  it('carries the provider id, the OpenCode key and the catalog model on every option', () => {
    const aliased = [
      makeProvider('anthropic', 'Anthropic', [
        makeModel('claude-sonnet-4-5-20250929', { key: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' }),
      ]),
    ]
    const sections = buildModelSections(aliased, undefined, 'anthropic/claude-sonnet-4.5')

    const defaultOption = sections[0].options[0]
    expect(defaultOption.providerID).toBe('anthropic')
    expect(defaultOption.modelID).toBe('claude-sonnet-4.5')
    expect(defaultOption.value).toBe('anthropic/claude-sonnet-4.5')
    expect(defaultOption.providerName).toBe('Anthropic')
    expect(defaultOption.model.id).toBe('claude-sonnet-4-5-20250929')
  })
})

describe('filterModelSections', () => {
  it('returns one flat results section with favorites first', () => {
    const sections = buildModelSections(providers, {
      favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
      recent: [],
      variant: {},
    })

    const results = filterModelSections(sections, 'claude')

    expect(results).toHaveLength(1)
    expect(results[0].key).toBe('results')
    expect(results[0].options.map((option) => option.label)).toEqual(['Claude Sonnet', 'Claude Haiku', 'Claude Opus'])
    expect(results[0].options[0].providerName).toBe('Anthropic')
  })

  it('sorts non-favorite matches by name without provider grouping', () => {
    const sections = buildModelSections(providers, undefined)

    const results = filterModelSections(sections, 'gpt')

    expect(results[0].options.map((option) => option.value)).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'openai/gpt-5',
    ])
  })

  it('matches every search term', () => {
    const sections = buildModelSections(providers, undefined)

    expect(filterModelSections(sections, 'openai gpt-4o').map((section) => section.options.map((option) => option.value))).toEqual([
      ['openai/gpt-4o', 'openai/gpt-4o-mini'],
    ])
  })

  it('returns nothing when no option matches', () => {
    expect(filterModelSections(buildModelSections(providers, undefined), 'zzz')).toEqual([])
  })

  it('returns the sections unchanged for an empty query', () => {
    const sections = buildModelSections(providers, undefined)

    expect(filterModelSections(sections, '   ')).toEqual(sections)
  })

  it('lists a favorite that is also the default only once', () => {
    const sections = buildModelSections(
      providers,
      { favorite: [{ providerID: 'openai', modelID: 'gpt-5' }], recent: [], variant: {} },
      'openai/gpt-5',
    )

    const unfiltered = filterModelSections(sections, '')
    expect(unfiltered.some((section) => section.key === 'favorites')).toBe(false)
    expect(valuesOf(unfiltered, 'default')).toEqual(['openai/gpt-5'])

    const searched = filterModelSections(sections, 'gpt-5')
    expect(searched[0].options.map((option) => option.value)).toEqual(['openai/gpt-5'])
  })
})

describe('toModelComboboxOptions', () => {
  it('maps each option to the section title group and its own value as the description', () => {
    const sections = buildModelSections(
      providers,
      {
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
        recent: [],
        variant: {},
      },
      'openai/gpt-5',
    )

    const options = toModelComboboxOptions(sections, 'openai/gpt-5')

    expect(options[0]).toEqual({ value: '', label: 'Default: GPT-5', description: undefined, group: 'Default' })
    expect(options[1]).toEqual({
      value: 'anthropic/claude-sonnet',
      label: 'Claude Sonnet',
      description: 'anthropic/claude-sonnet',
      group: 'Favorites',
    })
    expect(options.find((option) => option.value === 'openai/gpt-4o-mini')).toEqual({
      value: 'openai/gpt-4o-mini',
      label: 'GPT-4o mini',
      description: 'openai/gpt-4o-mini',
      group: 'OpenAI',
    })
  })

  it('hides the favorite copy of the default model behind the Default entry', () => {
    const sections = buildModelSections(
      providers,
      {
        favorite: [
          { providerID: 'openai', modelID: 'gpt-5' },
          { providerID: 'anthropic', modelID: 'claude-sonnet' },
        ],
        recent: [],
        variant: {},
      },
      'openai/gpt-5',
    )

    const options = toModelComboboxOptions(sections, 'openai/gpt-5')

    expect(options.filter((option) => option.label.includes('GPT-5'))).toEqual([
      { value: '', label: 'Default: GPT-5', description: undefined, group: 'Default' },
    ])
    expect(options[1]?.value).toBe('anthropic/claude-sonnet')
  })

  it('leaves the default ref untouched when no default is resolved', () => {
    const sections = buildModelSections(providers, undefined, 'openai/gpt-5')

    expect(toModelComboboxOptions(sections)[0]).toEqual({
      value: 'openai/gpt-5',
      label: 'GPT-5',
      description: 'openai/gpt-5',
      group: 'Default',
    })
  })
})
