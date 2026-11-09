import { describe, it, expect } from 'vitest'
import { buildNavModel, buildToolItems } from './navItems'

describe('buildNavModel items', () => {
  it('returns Home + All Schedules + Files + Settings + Logout for root path', () => {
    const items = buildNavModel('/').items
    expect(items).toHaveLength(5)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('all-schedules')
    expect(items[2].key).toBe('files')
    expect(items[3].key).toBe('settings')
    expect(items[4].key).toBe('logout')
  })

  it('returns repo-specific items for /repos/:id', () => {
    const items = buildNavModel('/repos/42').items
    expect(items).toHaveLength(13)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('files')
    expect(items[1].dialog).toBe('files')
    expect(items[2].key).toBe('mcp')
    expect(items[2].dialog).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[3].dialog).toBe('skills')
    expect(items[4].key).toBe('secrets')
    expect(items[4].dialog).toBe('secrets')
    expect(items[5].key).toBe('reset-permissions')
    expect(items[5].dialog).toBe('resetPermissions')
    expect(items[5].danger).toBe(true)
    expect(items[6].key).toBe('schedules')
    expect(items[6].to).toBe('/repos/42/schedules')
    expect(items[7].key).toBe('source-control')
    expect(items[7].dialog).toBe('sourceControl')
    expect(items[8].key).toBe('terminal')
    expect(items[8].dialog).toBe('terminal')
    expect(items[9].key).toBe('actions')
    expect(items[9].dialog).toBe('actions')
    expect(items[10].key).toBe('preview')
    expect(items[10].dialog).toBe('preview')
    expect(items[11].key).toBe('settings')
    expect(items[12].key).toBe('logout')
  })

  it('returns session-specific items for /repos/:id/sessions/:sid', () => {
    const items = buildNavModel('/repos/42/sessions/abc').items
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

  it('returns only the server tools a linked server can serve for /servers/:id/sessions/:sid', () => {
    const items = buildNavModel('/servers/srv_kitchen/sessions/abc').items
    expect(items.map((item) => item.key)).toEqual([
      'home',
      'mcp',
      'skills',
      'source-control',
      'terminal',
      'settings',
      'logout',
    ])
  })

  it('returns only the server tools a linked server can serve for /servers/:id/projects', () => {
    const items = buildNavModel('/servers/srv_kitchen/projects').items
    expect(items.map((item) => item.key)).toEqual([
      'home',
      'mcp',
      'skills',
      'source-control',
      'terminal',
      'settings',
      'logout',
    ])
    expect(items.find((item) => item.key === 'source-control')?.dialog).toBe('sourceControl')
  })

  it('omits the Actions item for an Assistant session', () => {
    const items = buildNavModel('/repos/0/sessions/abc').items
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
    const items = buildNavModel('/repos/42/assistant').items
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
    const items = buildNavModel('/schedules').items
    expect(items).toHaveLength(3)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('settings')
    expect(items[2].key).toBe('logout')
  })

  it('returns only Home + Settings + Logout for /repos/:id/schedules', () => {
    const items = buildNavModel('/repos/42/schedules').items
    expect(items).toHaveLength(3)
    expect(items[0].key).toBe('home')
    expect(items[1].key).toBe('settings')
    expect(items[2].key).toBe('logout')
  })

  it('returns only Home + Settings + Logout for unknown paths', () => {
    const items = buildNavModel('/unknown/path').items
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
      const [first] = buildNavModel(path).items
      expect(first.key).toBe('home')
      expect(first.label).toBe('Home')
      expect(first.to).toBe('/')
    }
  })
})

describe('buildToolItems', () => {
  it.each([
    ['/', 'all-schedules'],
    ['/repos/42', 'files'],
    ['/repos/42/sessions/abc', 'files'],
    ['/assistant', 'files'],
  ])('starts %s with the route first tool', (path, firstTool) => {
    expect(buildToolItems(path)[0].key).toBe(firstTool)
  })

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

  it('returns the linked-server session tools for the tool rail', () => {
    expect(buildToolItems('/servers/srv_kitchen/sessions/abc').map((item) => item.key)).toEqual([
      'mcp',
      'skills',
      'source-control',
      'terminal',
    ])
  })

  it('returns the linked-server project tools for the tool rail', () => {
    expect(buildToolItems('/servers/srv_kitchen/projects').map((item) => item.key)).toEqual([
      'mcp',
      'skills',
      'source-control',
      'terminal',
    ])
  })

  it('returns the home route tools', () => {
    expect(buildToolItems('/').map((item) => item.key)).toEqual(['all-schedules', 'files'])
  })

  it.each(['/repos/42', '/assistant'])('opens schedules in the panel on %s', (path) => {
    expect(buildToolItems(path).find((item) => item.key === 'schedules')?.panelTool).toBe('schedules')
  })

  it('exposes the repo Secrets tool through the shared dialog param', () => {
    const secrets = buildToolItems('/repos/42').find((item) => item.key === 'secrets')
    expect(secrets?.dialog).toBe('secrets')
    expect(secrets?.panelTool).toBeUndefined()
  })

  it.each(['/schedules', '/repos/42/schedules'])('returns no tool items on %s', (path) => {
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
})
