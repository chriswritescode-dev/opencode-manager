import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { InMemoryCacheService } from '../src/cache/memory-cache'
import { createCacheService } from '../src/cache'

describe('InMemoryCacheService', () => {
  let cache: InMemoryCacheService

  beforeEach(() => {
    cache = new InMemoryCacheService()
  })

  afterEach(() => {
    cache.destroy()
  })

  test('In-memory cache set/get', async () => {
    await cache.set('test-key', { foo: 'bar' })
    const result = await cache.get<{ foo: string }>('test-key')

    expect(result).toEqual({ foo: 'bar' })
  })

  test('Cache miss returns null', async () => {
    const result = await cache.get('non-existent-key')
    expect(result).toBeNull()
  })

  test('TTL expiration — set with short TTL, verify expired after timeout', async () => {
    await cache.set('expiring-key', 'value', 1)
    
    const resultBeforeExpiry = await cache.get('expiring-key')
    expect(resultBeforeExpiry).toBe('value')

    await new Promise(resolve => setTimeout(resolve, 1100))

    const resultAfterExpiry = await cache.get('expiring-key')
    expect(resultAfterExpiry).toBeNull()
  })

  test('Pattern invalidation — set multiple keys, invalidate with glob pattern', async () => {
    await cache.set('mem:repo:1:key1', 'value1')
    await cache.set('mem:repo:1:key2', 'value2')
    await cache.set('mem:repo:2:key1', 'value3')

    await cache.invalidatePattern('mem:repo:1:*')

    const result1 = await cache.get('mem:repo:1:key1')
    const result2 = await cache.get('mem:repo:1:key2')
    const result3 = await cache.get('mem:repo:2:key1')

    expect(result1).toBeNull()
    expect(result2).toBeNull()
    expect(result3).toBe('value3')
  })

  test('del removes key', async () => {
    await cache.set('key-to-delete', 'value')
    await cache.del('key-to-delete')

    const result = await cache.get('key-to-delete')
    expect(result).toBeNull()
  })

  test('Destroy clears all entries', async () => {
    await cache.set('key1', 'value1')
    await cache.set('key2', 'value2')

    cache.destroy()

    const result1 = await cache.get('key1')
    const result2 = await cache.get('key2')

    expect(result1).toBeNull()
    expect(result2).toBeNull()
  })

  test('Default TTL is 24 hours', async () => {
    const now = Date.now()
    await cache.set('default-ttl-key', 'value')

    const entry = (cache as unknown as { cache: Map<string, { expiresAt: number }> }).cache.get('default-ttl-key')
    expect(entry).toBeDefined()
    expect(entry!.expiresAt).toBeGreaterThan(now + 86300000)
    expect(entry!.expiresAt).toBeLessThanOrEqual(now + 86500000)
  })
})

describe('createCacheService', () => {
  test('returns in-memory cache', async () => {
    const cache = createCacheService()

    await cache.set('test-key', 'test-value')
    const result = await cache.get('test-key')

    expect(result).toBe('test-value')
  })

  test('in-memory cache handles various data types', async () => {
    const cache = createCacheService()

    await cache.set('string', 'hello')
    await cache.set('number', 42)
    await cache.set('boolean', true)
    await cache.set('object', { nested: { value: 'deep' } })
    await cache.set('array', [1, 2, 3])

    expect(await cache.get('string')).toBe('hello')
    expect(await cache.get('number')).toBe(42)
    expect(await cache.get('boolean')).toBe(true)
    expect(await cache.get('object')).toEqual({ nested: { value: 'deep' } })
    expect(await cache.get('array')).toEqual([1, 2, 3])
  })

  test('cache handles empty string key', async () => {
    const cache = createCacheService()

    await cache.set('', 'empty-key-value')
    const result = await cache.get('')

    expect(result).toBe('empty-key-value')
  })

  test('invalidatePattern handles no matches', async () => {
    const cache = createCacheService()

    await cache.set('key1', 'value1')
    await cache.set('key2', 'value2')

    await cache.invalidatePattern('nonexistent:*')

    expect(await cache.get('key1')).toBe('value1')
    expect(await cache.get('key2')).toBe('value2')
  })

  test('invalidatePattern handles wildcard only', async () => {
    const cache = createCacheService()

    await cache.set('key1', 'value1')
    await cache.set('key2', 'value2')

    await cache.invalidatePattern('*')

    expect(await cache.get('key1')).toBeNull()
    expect(await cache.get('key2')).toBeNull()
  })
})
