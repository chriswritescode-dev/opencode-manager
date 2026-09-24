import { describe, it, expect } from 'vitest'
import type { FormAnswer, FormField } from '@opencode-manager/shared/opencode'
import {
  buildAnswer,
  defaultAnswers,
  hasFields,
  hasMissingAnswers,
  isFieldVisible,
  resolveAnswers,
  setAnswerValue,
  visibleFields,
} from './formFields'

const fields: FormField[] = [
  {
    key: 'deploymentType',
    title: 'Select GitHub deployment type',
    type: 'string',
    required: true,
    options: [
      { value: 'github.com', label: 'GitHub.com' },
      { value: 'enterprise', label: 'GitHub Enterprise' },
    ],
  },
  {
    key: 'enterpriseUrl',
    title: 'Enter your GitHub Enterprise URL or domain',
    type: 'string',
    required: true,
    when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
  },
  {
    key: 'approve',
    type: 'external',
    url: 'https://example.com/approve',
    title: 'Approve access',
    description: 'Approve the application in the provider dashboard',
  },
]

describe('isFieldVisible', () => {
  it('shows an unconditional field', () => {
    expect(isFieldVisible(fields[0], {})).toBe(true)
  })

  it('requires an answered condition to match', () => {
    expect(isFieldVisible(fields[1], {})).toBe(false)
    expect(isFieldVisible(fields[1], { deploymentType: 'github.com' })).toBe(false)
    expect(isFieldVisible(fields[1], { deploymentType: 'enterprise' })).toBe(true)
  })

  it('always shows external fields', () => {
    expect(isFieldVisible(fields[2], {})).toBe(true)
  })

  it('supports neq conditions and array answers', () => {
    const conditional: FormField = {
      key: 'other',
      type: 'string',
      when: [{ key: 'features', op: 'neq', value: 'skip' }],
    }
    expect(isFieldVisible(conditional, { features: ['skip'] })).toBe(false)
    expect(isFieldVisible(conditional, { features: ['keep'] })).toBe(true)
  })

  it('hides fields marked hidden', () => {
    const hidden: FormField = { key: 'secret', type: 'string', hidden: true, default: 'x' }
    expect(isFieldVisible(hidden, {})).toBe(false)
  })
})

describe('visibleFields', () => {
  it('hides conditional fields until their condition holds', () => {
    expect(visibleFields(fields, {}).map((field) => field.key)).toEqual(['deploymentType', 'approve'])
    expect(visibleFields(fields, { deploymentType: 'enterprise' }).map((field) => field.key))
      .toEqual(['deploymentType', 'enterpriseUrl', 'approve'])
  })
})

describe('defaultAnswers', () => {
  it('pre-populates declared defaults and skips external fields', () => {
    const withDefaults: FormField[] = [
      { key: 'server', type: 'string', default: 'https://example.com' },
      { key: 'features', type: 'multiselect', options: [{ value: 'a', label: 'A' }], default: ['a'] },
      fields[2],
    ]

    expect(defaultAnswers(withDefaults)).toEqual({ server: 'https://example.com', features: ['a'] })
  })
})

describe('hasMissingAnswers', () => {
  it('requires only visible required fields', () => {
    expect(hasMissingAnswers(fields, {})).toBe(true)
    expect(hasMissingAnswers(fields, { deploymentType: 'github.com' })).toBe(false)
    expect(hasMissingAnswers(fields, { deploymentType: 'enterprise' })).toBe(true)
    expect(hasMissingAnswers(fields, { deploymentType: 'enterprise', enterpriseUrl: 'company.ghe.com' })).toBe(false)
  })
})

describe('buildAnswer', () => {
  it('sends only visible fields and drops values a condition hid', () => {
    const answer: FormAnswer = {
      deploymentType: 'github.com',
      enterpriseUrl: 'stale.ghe.com',
    }

    expect(buildAnswer(fields, answer)).toEqual({ deploymentType: 'github.com' })
  })

  it('omits hidden fields and external fields', () => {
    const answer: FormAnswer = { secret: 'value', deploymentType: 'github.com' }
    const withHidden: FormField[] = [
      ...fields,
      { key: 'secret', type: 'string', hidden: true },
    ]

    expect(buildAnswer(withHidden, answer)).toEqual({ deploymentType: 'github.com' })
  })
})

describe('resolveAnswers', () => {
  it('merges defaults with stored answers', () => {
    const withDefaults: FormField[] = [
      { key: 'server', type: 'string', default: 'https://example.com' },
      { key: 'name', type: 'string' },
    ]

    expect(resolveAnswers(withDefaults, { name: 'ada' })).toEqual({
      server: 'https://example.com',
      name: 'ada',
    })
  })
})

describe('hasFields', () => {
  it('reports whether a method exposes form fields', () => {
    expect(hasFields(undefined)).toBe(false)
    expect(hasFields([])).toBe(false)
    expect(hasFields(fields)).toBe(true)
  })
})

describe('setAnswerValue', () => {
  it('sets and deletes answers keyed by method', () => {
    const updated = setAnswerValue({}, 'key', 'name', 'ada')
    expect(updated).toEqual({ key: { name: 'ada' } })
    expect(setAnswerValue(updated, 'key', 'name', undefined)).toEqual({ key: {} })
  })
})
