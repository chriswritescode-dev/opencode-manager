import { describe, expect, it } from 'vitest'
import { normalizeToBaseUrl } from '../../src/utils/discovery-cache'

describe('normalizeToBaseUrl', () => {
  it.each([
    ['http://host:9000', 'http://host:9000'],
    ['http://host:9000/', 'http://host:9000'],
    ['http://host:9000/v1', 'http://host:9000'],
    ['http://host:9000/v1/', 'http://host:9000'],
    ['http://host:9000/v1/audio/transcriptions', 'http://host:9000'],
    ['http://host:8880/v1/audio/speech', 'http://host:8880'],
    ['http://host:8880/audio/speech', 'http://host:8880'],
  ])('reduces %s to the server base %s', (endpoint, expected) => {
    expect(normalizeToBaseUrl(endpoint)).toBe(expected)
  })
})
