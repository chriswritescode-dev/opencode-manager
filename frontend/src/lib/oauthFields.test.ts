import { describe, it, expect } from 'vitest'
import type { PromptAnswer, ProviderAuthMethod } from '@/api/oauth'
import { buildAnswer, defaultAnswer, hasMissingAnswers, isFieldActive, visibleFields } from './oauthFields'

const method: ProviderAuthMethod = {
  id: 'device',
  type: 'oauth',
  label: 'Login with GitHub Copilot',
  fields: [
    {
      type: 'select',
      key: 'deploymentType',
      message: 'Select GitHub deployment type',
      options: [
        { label: 'GitHub.com', value: 'github.com' },
        { label: 'GitHub Enterprise', value: 'enterprise' },
      ],
      required: true,
    },
    {
      type: 'text',
      key: 'enterpriseUrl',
      message: 'Enter your GitHub Enterprise URL or domain',
      required: true,
      when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
    },
  ],
}

describe('isFieldActive', () => {
  it('activates an unconditional field', () => {
    expect(isFieldActive(method.fields![0], {})).toBe(true)
  })

  it('requires an answered condition to match', () => {
    expect(isFieldActive(method.fields![1], {})).toBe(false)
    expect(isFieldActive(method.fields![1], { deploymentType: 'github.com' })).toBe(false)
    expect(isFieldActive(method.fields![1], { deploymentType: 'enterprise' })).toBe(true)
  })
})

describe('visibleFields', () => {
  it('hides conditional fields until their condition holds', () => {
    expect(visibleFields(method, {}).map((field) => field.key)).toEqual(['deploymentType'])
    expect(visibleFields(method, { deploymentType: 'enterprise' }).map((field) => field.key))
      .toEqual(['deploymentType', 'enterpriseUrl'])
  })
})

describe('defaultAnswer', () => {
  it('pre-populates declared defaults and skips external fields', () => {
    const withDefaults: ProviderAuthMethod = {
      ...method,
      fields: [
        { type: 'text', key: 'server', message: 'Server', default: 'https://example.com' },
        { type: 'external', key: 'ack', message: 'Approve', url: 'https://example.com/approve' },
      ],
    }

    expect(defaultAnswer(withDefaults)).toEqual({ server: 'https://example.com' })
  })
})

describe('hasMissingAnswers', () => {
  it('requires only active required fields', () => {
    expect(hasMissingAnswers(method, {})).toBe(true)
    expect(hasMissingAnswers(method, { deploymentType: 'github.com' })).toBe(false)
    expect(hasMissingAnswers(method, { deploymentType: 'enterprise' })).toBe(true)
    expect(hasMissingAnswers(method, { deploymentType: 'enterprise', enterpriseUrl: 'company.ghe.com' })).toBe(false)
  })
})

describe('buildAnswer', () => {
  it('sends only active fields and drops values a condition hid', () => {
    const answer: PromptAnswer = {
      deploymentType: 'github.com',
      enterpriseUrl: 'stale.ghe.com',
    }

    expect(buildAnswer(method, answer)).toEqual({ deploymentType: 'github.com' })
  })
})
