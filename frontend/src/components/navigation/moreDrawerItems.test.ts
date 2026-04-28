import { describe, it, expect } from 'vitest'
import { buildMoreItems, buildNavModel } from './moreDrawerItems'

describe('buildMoreItems', () => {
  it('returns Settings + Logout + All Schedules + Files for root path', () => {
    const items = buildMoreItems('/')
    expect(items).toHaveLength(4)
    expect(items[0].key).toBe('all-schedules')
    expect(items[1].key).toBe('files')
    expect(items[2].key).toBe('settings')
    expect(items[3].key).toBe('logout')
  })

  it('returns repo-specific items with memory when plugin enabled for /repos/:id', () => {
    const items = buildMoreItems('/repos/42', { memoryPluginEnabled: true })
    expect(items).toHaveLength(9)
    expect(items[0].key).toBe('files')
    expect(items[0].dialog).toBe('files')
    expect(items[1].key).toBe('memory')
    expect(items[1].to).toBe('/repos/42/memories')
    expect(items[2].key).toBe('mcp')
    expect(items[2].dialog).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[3].dialog).toBe('skills')
    expect(items[4].key).toBe('reset-permissions')
    expect(items[4].dialog).toBe('resetPermissions')
    expect(items[4].danger).toBe(true)
    expect(items[5].key).toBe('schedules')
    expect(items[5].to).toBe('/repos/42/schedules')
    expect(items[6].key).toBe('source-control')
    expect(items[6].dialog).toBe('sourceControl')
    expect(items[7].key).toBe('settings')
    expect(items[8].key).toBe('logout')
  })

  it('omits memory item for /repos/:id when plugin disabled', () => {
    const items = buildMoreItems('/repos/42')
    expect(items).toHaveLength(8)
    expect(items.some((item) => item.key === 'memory')).toBe(false)
    expect(items[0].key).toBe('files')
    expect(items[1].key).toBe('mcp')
  })

  it('returns session-specific items with memory when plugin enabled for /repos/:id/sessions/:sid', () => {
    const items = buildMoreItems('/repos/42/sessions/abc', { memoryPluginEnabled: true })
    expect(items).toHaveLength(9)
    expect(items[0].key).toBe('files')
    expect(items[1].key).toBe('memory')
    expect(items[2].key).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[4].key).toBe('lsp')
    expect(items[4].dialog).toBe('lsp')
    expect(items[5].key).toBe('reset-permissions')
    expect(items[6].key).toBe('source-control')
    expect(items[7].key).toBe('settings')
    expect(items[8].key).toBe('logout')
  })

  it('omits memory item for /repos/:id/sessions/:sid when plugin disabled', () => {
    const items = buildMoreItems('/repos/42/sessions/abc')
    expect(items).toHaveLength(8)
    expect(items.some((item) => item.key === 'memory')).toBe(false)
    expect(items[0].key).toBe('files')
    expect(items[1].key).toBe('mcp')
  })

  it('returns assistant workspace items for /repos/:id/assistant', () => {
    const items = buildMoreItems('/repos/42/assistant', { memoryPluginEnabled: true })
    expect(items).toHaveLength(9)
    expect(items[0].key).toBe('files')
    expect(items[0].dialog).toBe('files')
    expect(items[1].key).toBe('memory')
    expect(items[1].to).toBe('/repos/42/memories')
    expect(items[2].key).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[4].key).toBe('reset-permissions')
    expect(items[5].key).toBe('schedules')
    expect(items[6].key).toBe('source-control')
    expect(items[7].key).toBe('settings')
    expect(items[8].key).toBe('logout')
  })

  it('returns only Settings + Logout for /repos/:id/memories', () => {
    const items = buildMoreItems('/repos/42/memories')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns only Settings + Logout for /schedules', () => {
    const items = buildMoreItems('/schedules')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns only Settings + Logout for /repos/:id/schedules', () => {
    const items = buildMoreItems('/repos/42/schedules')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns only Settings + Logout for unknown paths', () => {
    const items = buildMoreItems('/unknown/path')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })
})

describe('buildNavModel', () => {
  it('returns new-repo primary CTA for root path', () => {
    const model = buildNavModel('/')
    expect(model.primary).toHaveLength(2)
    expect(model.primary[0].key).toBe('new-repo')
    expect(model.primary[0].onSelect).toBe('new-repo')
    expect(model.primary[1].key).toBe('assistant')
    expect(model.primary[1].to).toBe('/assistant')
  })

  it('returns new-session and assistant primary CTAs for repo detail', () => {
    const model = buildNavModel('/repos/5')
    expect(model.primary).toHaveLength(2)
    expect(model.primary[0].key).toBe('new-session')
    expect(model.primary[0].onSelect).toBe('new-session')
    expect(model.primary[1].key).toBe('assistant')
    expect(model.primary[1].to).toBe('/repos/5/assistant')
  })

  it('returns new-session and assistant primary CTAs for session detail', () => {
    const model = buildNavModel('/repos/5/sessions/abc')
    expect(model.primary).toHaveLength(2)
    expect(model.primary[0].key).toBe('new-session')
    expect(model.primary[0].onSelect).toBe('new-session')
    expect(model.primary[0].variant).toBe('primary')
    expect(model.primary[1].key).toBe('assistant')
    expect(model.primary[1].to).toBe('/repos/5/assistant')
    expect(model.primary[1].variant).toBe('secondary')
  })

  it('returns new-session and assistant primary CTAs for assistant workspace', () => {
    const model = buildNavModel('/repos/5/assistant')
    expect(model.primary).toHaveLength(2)
    expect(model.primary[0].key).toBe('new-session')
    expect(model.primary[0].onSelect).toBe('new-session')
    expect(model.primary[0].variant).toBe('primary')
    expect(model.primary[1].key).toBe('assistant')
    expect(model.primary[1].to).toBe('/repos/5/assistant')
    expect(model.primary[1].variant).toBe('secondary')
  })

  it('returns new-schedule primary CTA for schedules routes', () => {
    const model1 = buildNavModel('/schedules')
    expect(model1.primary).toHaveLength(2)
    expect(model1.primary[0].key).toBe('new-schedule')
    expect(model1.primary[0].onSelect).toBe('new-schedule')
    expect(model1.primary[1].key).toBe('assistant')
    expect(model1.primary[1].to).toBe('/assistant')

    const model2 = buildNavModel('/repos/5/schedules')
    expect(model2.primary).toHaveLength(2)
    expect(model2.primary[0].key).toBe('new-schedule')
    expect(model2.primary[0].onSelect).toBe('new-schedule')
    expect(model2.primary[1].key).toBe('assistant')
    expect(model2.primary[1].to).toBe('/repos/5/assistant')
  })

  it('returns empty primary for memories routes', () => {
    const model = buildNavModel('/repos/5/memories')
    expect(model.primary).toHaveLength(1)
    expect(model.primary[0].key).toBe('assistant')
    expect(model.primary[0].to).toBe('/repos/5/assistant')
  })

  it('returns assistant primary for unknown routes', () => {
    const model = buildNavModel('/unknown/path')
    expect(model.primary).toHaveLength(1)
    expect(model.primary[0].key).toBe('assistant')
    expect(model.primary[0].to).toBe('/assistant')
  })

  it('preserves backwards compatibility with buildMoreItems', () => {
    const model = buildNavModel('/repos/42', { memoryPluginEnabled: true })
    const items = buildMoreItems('/repos/42', { memoryPluginEnabled: true })
    expect(model.items).toEqual(items)
  })
})
