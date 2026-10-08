import { describe, it, expect } from 'vitest'
import { buildMoreItems, buildNavModel, buildToolItems } from './moreDrawerItems'

describe('buildMoreItems', () => {
  it('returns Home + All Schedules + Files + Settings + Logout for root path', () => {
    const items = buildMoreItems('/')
    expect(items).toHaveLength(5)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('all-schedules')
    expect(items[2].key).toBe('files')
    expect(items[3].key).toBe('settings')
    expect(items[4].key).toBe('logout')
  })

  it('returns repo-specific items for /repos/:id', () => {
    const items = buildMoreItems('/repos/42')
    expect(items).toHaveLength(12)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('files')
    expect(items[1].dialog).toBe('files')
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
    expect(items[7].key).toBe('terminal')
    expect(items[7].dialog).toBe('terminal')
    expect(items[8].key).toBe('actions')
    expect(items[8].dialog).toBe('actions')
    expect(items[9].key).toBe('preview')
    expect(items[9].dialog).toBe('preview')
    expect(items[10].key).toBe('settings')
    expect(items[11].key).toBe('logout')
  })

  it('returns session-specific items for /repos/:id/sessions/:sid', () => {
    const items = buildMoreItems('/repos/42/sessions/abc')
    expect(items).toHaveLength(13)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('files')
    expect(items[2].key).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[4].key).toBe('reset-permissions')
    expect(items[5].key).toBe('schedules')
    expect(items[5].to).toBe('/repos/42/schedules')
    expect(items[6].key).toBe('source-control')
    expect(items[7].key).toBe('terminal')
    expect(items[7].dialog).toBe('terminal')
    expect(items[8].key).toBe('walkthrough')
    expect(items[8].dialog).toBe('walkthrough')
    expect(items[9].key).toBe('actions')
    expect(items[9].dialog).toBe('actions')
    expect(items[10].key).toBe('preview')
    expect(items[10].dialog).toBe('preview')
    expect(items[11].key).toBe('settings')
    expect(items[12].key).toBe('logout')
  })

  it('omits the Actions item for an Assistant session', () => {
    const items = buildMoreItems('/repos/0/sessions/abc')
    expect(items).toHaveLength(12)
    expect(items.map((item) => item.key)).not.toContain('actions')
    expect(items[7].key).toBe('terminal')
    expect(items[8].key).toBe('walkthrough')
    expect(items[9].key).toBe('preview')
    expect(items[9].dialog).toBe('preview')
    expect(items[10].key).toBe('settings')
    expect(items[11].key).toBe('logout')
  })

  it('returns assistant workspace items for /repos/:id/assistant', () => {
    const items = buildMoreItems('/repos/42/assistant')
    expect(items).toHaveLength(11)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('files')
    expect(items[1].dialog).toBe('files')
    expect(items[2].key).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[4].key).toBe('reset-permissions')
    expect(items[5].key).toBe('schedules')
    expect(items[6].key).toBe('source-control')
    expect(items[7].key).toBe('terminal')
    expect(items[7].dialog).toBe('terminal')
    expect(items[8].key).toBe('preview')
    expect(items[8].dialog).toBe('preview')
    expect(items[9].key).toBe('settings')
    expect(items[10].key).toBe('logout')
  })

  it('returns only Home + Settings + Logout for /schedules', () => {
    const items = buildMoreItems('/schedules')
    expect(items).toHaveLength(3)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('settings')
    expect(items[2].key).toBe('logout')
  })

  it('returns only Home + Settings + Logout for /repos/:id/schedules', () => {
    const items = buildMoreItems('/repos/42/schedules')
    expect(items).toHaveLength(3)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('settings')
    expect(items[2].key).toBe('logout')
  })

  it('returns only Home + Settings + Logout for unknown paths', () => {
    const items = buildMoreItems('/unknown/path')
    expect(items).toHaveLength(3)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('settings')
    expect(items[2].key).toBe('logout')
  })

  it('leads every route with a Home item routed to /', () => {
    const paths = [
      '/',
      '/repos/42',
      '/repos/42/sessions/abc',
      '/repos/42/assistant',
      '/assistant',
      '/schedules',
      '/repos/42/schedules',
      '/unknown/path',
    ]

    for (const path of paths) {
      const [first] = buildMoreItems(path)
      expect(first.key).toBe('home')
      expect(first.label).toBe('Home')
      expect(first.to).toBe('/')
    }
  })
})

describe('buildToolItems', () => {
  it('returns the session route items without home and account entries', () => {
    expect(buildToolItems('/repos/42/sessions/abc').map((item) => item.key)).toEqual([
      'files',
      'mcp',
      'skills',
      'reset-permissions',
      'schedules',
      'source-control',
      'terminal',
      'walkthrough',
      'actions',
      'preview',
    ])
  })

  it('returns the home route tools', () => {
    expect(buildToolItems('/').map((item) => item.key)).toEqual(['all-schedules', 'files'])
  })

  it.each(['/repos/42', '/assistant'])('opens schedules in the panel on %s', (path) => {
    expect(buildToolItems(path).find((item) => item.key === 'schedules')?.panelTool).toBe('schedules')
  })

  it.each(['/schedules', '/repos/42/schedules'])('returns nothing on %s', (path) => {
    expect(buildToolItems(path)).toEqual([])
  })
})

describe('buildNavModel', () => {
  it.each([
    '/',
    '/repos/5',
    '/repos/5/sessions/abc',
    '/repos/5/assistant',
    '/assistant',
    '/schedules',
    '/repos/5/schedules',
    '/unknown/path',
  ])('returns only the assistant primary CTA for %s', (path) => {
    const model = buildNavModel(path)
    expect(model.primary).toHaveLength(1)
    expect(model.primary[0].key).toBe('assistant')
    expect(model.primary[0].to).toBe('/assistant')
    expect(model.primary[0].variant).toBe('secondary')
  })

  it('preserves backwards compatibility with buildMoreItems', () => {
    const model = buildNavModel('/repos/42')
    const items = buildMoreItems('/repos/42')
    expect(model.items).toEqual(items)
  })
})
