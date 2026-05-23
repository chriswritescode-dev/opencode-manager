import { describe, it, expect, vi } from 'vitest'

const mockFn = vi.hoisted(() => vi.fn().mockReturnValue('mocked'))

describe('bun test vi.hoisted compatibility', () => {
  it('supports vi.hoisted', () => {
    expect(mockFn()).toBe('mocked')
  })
})
