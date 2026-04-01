import { describe, test, expect } from 'bun:test'
import { findPartialMatch, filterByPartial } from '../src/utils/partial-match'

interface TestItem {
  worktreeName: string
  worktreeBranch?: string
  value: string
}

describe('findPartialMatch', () => {
  test('exact match returns single result', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
      { worktreeName: 'loop-update-deps', value: 'c' },
    ]

    const result = findPartialMatch('loop-feat-auth', items, (i) => [i.worktreeName])

    expect(result.match).toBe(items[0])
    expect(result.candidates).toEqual([])
  })

  test('substring match returns single result', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
      { worktreeName: 'loop-update-deps', value: 'c' },
    ]

    const result = findPartialMatch('auth', items, (i) => [i.worktreeName])

    expect(result.match).toBe(items[0])
    expect(result.candidates).toEqual([])
  })

  test('case-insensitive substring match', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
    ]

    const result = findPartialMatch('AUTH', items, (i) => [i.worktreeName])

    expect(result.match).toBe(items[0])
    expect(result.candidates).toEqual([])
  })

  test('multiple substring matches returns candidates', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-auth-fix', value: 'b' },
      { worktreeName: 'loop-update-deps', value: 'c' },
    ]

    const result = findPartialMatch('auth', items, (i) => [i.worktreeName])

    expect(result.match).toBeNull()
    expect(result.candidates).toEqual([items[0], items[1]])
  })

  test('no matches returns null and empty candidates', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
    ]

    const result = findPartialMatch('nonexistent', items, (i) => [i.worktreeName])

    expect(result.match).toBeNull()
    expect(result.candidates).toEqual([])
  })

  test('exact match takes priority over multiple substring matches', () => {
    const items: TestItem[] = [
      { worktreeName: 'auth', value: 'a' },
      { worktreeName: 'loop-auth', value: 'b' },
      { worktreeName: 'auth-fix', value: 'c' },
    ]

    const result = findPartialMatch('auth', items, (i) => [i.worktreeName])

    expect(result.match).toBe(items[0])
    expect(result.candidates).toEqual([])
  })

  test('matches against worktreeBranch field', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', worktreeBranch: 'feat/auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', worktreeBranch: 'fix/bug', value: 'b' },
    ]

    const result = findPartialMatch('feat/auth', items, (i) => [i.worktreeName, i.worktreeBranch])

    expect(result.match).toBe(items[0])
    expect(result.candidates).toEqual([])
  })

  test('matches against worktreeBranch with partial input', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', worktreeBranch: 'feat/auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', worktreeBranch: 'fix/bug', value: 'b' },
    ]

    const result = findPartialMatch('feat', items, (i) => [i.worktreeName, i.worktreeBranch])

    expect(result.match).toBe(items[0])
    expect(result.candidates).toEqual([])
  })
})

describe('filterByPartial', () => {
  test('with filter returns filtered items', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
      { worktreeName: 'loop-update-deps', value: 'c' },
    ]

    const result = filterByPartial('auth', items, (i) => [i.worktreeName])

    expect(result).toEqual([items[0]])
  })

  test('without filter returns all items', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
    ]

    const result = filterByPartial(undefined, items, (i) => [i.worktreeName])

    expect(result).toEqual(items)
  })

  test('empty filter returns all items', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
    ]

    const result = filterByPartial('', items, (i) => [i.worktreeName])

    expect(result).toEqual(items)
  })

  test('case-insensitive filtering', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', value: 'b' },
    ]

    const result = filterByPartial('AUTH', items, (i) => [i.worktreeName])

    expect(result).toEqual([items[0]])
  })

  test('filters by worktreeBranch field', () => {
    const items: TestItem[] = [
      { worktreeName: 'loop-feat-auth', worktreeBranch: 'feat/auth', value: 'a' },
      { worktreeName: 'loop-fix-bug', worktreeBranch: 'fix/bug', value: 'b' },
    ]

    const result = filterByPartial('feat', items, (i) => [i.worktreeName, i.worktreeBranch])

    expect(result).toEqual([items[0]])
  })
})
