import { describe, expect, it } from 'vitest'
import type { SessionMessageAssistant, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { explorationLabel, groupExplorationParts } from './explorationGroups'

const tool = (id: string, name: string, status: 'completed' | 'running' = 'completed'): SessionMessageAssistantTool =>
  status === 'completed'
    ? { type: 'tool', id, name, state: { status, input: {}, content: [], metadata: {} }, time: { created: 0, ran: 0, completed: 1 } }
    : { type: 'tool', id, name, state: { status, input: {} }, time: { created: 0, ran: 0 } }

const text = (value: string): SessionMessageAssistant['content'][number] => ({ type: 'text', text: value })
const reasoning = (value: string): SessionMessageAssistant['content'][number] => ({ type: 'reasoning', text: value })

describe('groupExplorationParts', () => {
  it('collapses consecutive exploration tools and breaks runs on visible non-exploration parts', () => {
    const items = groupExplorationParts(
      [tool('a', 'read'), tool('b', 'grep'), text('found it'), tool('c', 'read'), tool('d', 'shell'), tool('e', 'glob')],
      false,
    )
    expect(items.map((item) => (item.type === 'exploration' ? item.parts.map((part) => part.id) : item.part.type))).toEqual([
      ['a', 'b'],
      'text',
      ['c'],
      'tool',
      ['e'],
    ])
  })

  it('does not let hidden reasoning or blank text split a run', () => {
    const items = groupExplorationParts([tool('a', 'read'), reasoning('thinking'), text('  '), tool('b', 'read')], false)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'exploration' })
  })

  it('lets visible reasoning split a run', () => {
    expect(groupExplorationParts([tool('a', 'read'), reasoning('thinking'), tool('b', 'read')], true)).toHaveLength(3)
  })
})

describe('explorationLabel', () => {
  it('counts tools with TUI nouns and pluralization', () => {
    expect(explorationLabel([tool('a', 'read'), tool('b', 'read'), tool('c', 'grep'), tool('d', 'glob'), tool('e', 'webfetch')]))
      .toBe('Explored: 2 reads, 2 searches, 1 fetch')
  })

  it('reports in-progress groups as exploring', () => {
    expect(explorationLabel([tool('a', 'read'), tool('b', 'read', 'running')])).toBe('Exploring: 2 reads')
  })
})
