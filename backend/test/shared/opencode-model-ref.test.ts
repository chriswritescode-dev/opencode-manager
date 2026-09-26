import { describe, expect, it } from 'vitest'
import { formatOpenCodeModelRef, parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'

describe('OpenCode model references', () => {
  describe('parseOpenCodeModelRef', () => {
    it('parses a provider and model id', () => {
      expect(parseOpenCodeModelRef('anthropic/claude-sonnet-4')).toEqual({
        providerID: 'anthropic',
        id: 'claude-sonnet-4',
      })
    })

    it('parses the variant after the hash', () => {
      expect(parseOpenCodeModelRef('openai/gpt-5#high')).toEqual({
        providerID: 'openai',
        id: 'gpt-5',
        variant: 'high',
      })
    })

    it('splits at the first slash so model ids may contain slashes', () => {
      expect(parseOpenCodeModelRef('openrouter/anthropic/claude-sonnet-4')).toEqual({
        providerID: 'openrouter',
        id: 'anthropic/claude-sonnet-4',
      })
    })

    it('rejects empty and malformed references', () => {
      expect(parseOpenCodeModelRef('')).toBeUndefined()
      expect(parseOpenCodeModelRef('openai')).toBeUndefined()
      expect(parseOpenCodeModelRef('/gpt-5')).toBeUndefined()
      expect(parseOpenCodeModelRef('openai/')).toBeUndefined()
      expect(parseOpenCodeModelRef('openai/gpt-5#')).toBeUndefined()
      expect(parseOpenCodeModelRef('openai/gpt-5#high#low')).toBeUndefined()
      expect(parseOpenCodeModelRef('open#ai/gpt-5')).toBeUndefined()
    })
  })

  describe('formatOpenCodeModelRef', () => {
    it('formats a provider and model id', () => {
      expect(formatOpenCodeModelRef({ providerID: 'anthropic', id: 'claude-sonnet-4' })).toBe(
        'anthropic/claude-sonnet-4',
      )
    })

    it('appends the variant when present', () => {
      expect(formatOpenCodeModelRef({ providerID: 'openai', id: 'gpt-5', variant: 'high' })).toBe(
        'openai/gpt-5#high',
      )
    })

    it('round-trips a parsed reference', () => {
      const model = 'openrouter/anthropic/claude-sonnet-4#beta'
      const ref = parseOpenCodeModelRef(model)

      expect(ref).toBeDefined()
      expect(formatOpenCodeModelRef(ref!)).toBe(model)
    })
  })
})
