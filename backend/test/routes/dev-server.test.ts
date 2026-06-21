import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/services/dev-server/manager', () => ({
  getDevServerState: vi.fn(),
  getDevServerPort: vi.fn(() => 5100),
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
  getDevServerConfig: vi.fn(),
  setDevServerConfig: vi.fn(),
}))

import { getDevServerState } from '../../src/services/dev-server/manager'
import { getRepoById, getDevServerConfig, setDevServerConfig } from '../../src/db/queries'
import { createDevServerRoutes } from '../../src/routes/dev-server'
import { createDevProxyRoutes } from '../../src/routes/dev-proxy'
import { injectBaseTag, rewriteDevProxyHtmlPaths, rewriteDevProxyJavaScriptPaths, rewriteViteClientHmrBase } from '../../src/services/dev-server/proxy-utils'

describe('DevServer Management Routes', () => {
  let devServerApp: ReturnType<typeof createDevServerRoutes>
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {} as any
    devServerApp = createDevServerRoutes(mockDb)
  })

  describe('GET /:repoId/status', () => {
    it('returns 404 when repo is not found', async () => {
      vi.mocked(getRepoById).mockReturnValue(null)

      const res = await devServerApp.fetch(new Request('http://localhost/999/status'))
      expect(res.status).toBe(404)
      const body = await res.json() as Record<string, unknown>
      expect(body.error).toBe('Repository not found')
    })

    it('returns configured preview port status', async () => {
      const mockRepo = { id: 1, fullPath: '/test/repo', repoUrl: null, localPath: '/test/repo' }
      vi.mocked(getRepoById).mockReturnValue(mockRepo as any)
      const mockState = {
        repoId: 1,
        status: 'running' as const,
        port: 5100,
        error: null,
        previewPath: '/api/dev-proxy/1/',
      }
      vi.mocked(getDevServerState).mockResolvedValue(mockState)

      const res = await devServerApp.fetch(new Request('http://localhost/1/status'))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.status).toBe('running')
      expect(body.port).toBe(5100)
      expect(body.previewPath).toBe('/api/dev-proxy/1/')
      expect(getDevServerState).toHaveBeenCalledWith(mockDb, 1)
    })
  })

  describe('GET /:repoId/config', () => {
    it('returns dev server config for repo', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: true })

      const res = await devServerApp.fetch(new Request('http://localhost/1/config'))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.injectBase).toBe(true)
    })

    it('returns 400 for invalid repoId', async () => {
      const res = await devServerApp.fetch(new Request('http://localhost/abc/config'))
      expect(res.status).toBe(400)
    })
  })

  describe('PUT /:repoId/config', () => {
    it('rejects body missing injectBase', async () => {
      const res = await devServerApp.fetch(
        new Request('http://localhost/1/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )
      expect(res.status).toBe(400)
    })

    it('rejects non-boolean injectBase', async () => {
      const res = await devServerApp.fetch(
        new Request('http://localhost/1/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ injectBase: 'yes' }),
        })
      )
      expect(res.status).toBe(400)
    })

    it('persists valid config and returns saved values', async () => {
      vi.mocked(setDevServerConfig).mockImplementation(() => {})
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: true })

      const res = await devServerApp.fetch(
        new Request('http://localhost/1/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ injectBase: true }),
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.injectBase).toBe(true)
      expect(setDevServerConfig).toHaveBeenCalledWith(mockDb, 1, { injectBase: true })
    })
  })
})

describe('DevProxy Routes', () => {
  let proxyApp: ReturnType<typeof createDevProxyRoutes>
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {} as any
    proxyApp = createDevProxyRoutes(mockDb)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('GET /:repoId/ and /:repoId/*', () => {
    it('returns 503 HTML when dev server is not running', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: false })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not running')))

      const res = await proxyApp.fetch(new Request('http://localhost/1/'))
      expect(res.status).toBe(503)
      const text = await res.text()
      expect(text).toContain('localhost:5100')
      expect(res.headers.get('content-type')).toContain('text/html')
    })

    it('returns 503 HTML when dev server is not running (sub-path)', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: false })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not running')))

      const res = await proxyApp.fetch(new Request('http://localhost/1/some/page'))
      expect(res.status).toBe(503)
      const text = await res.text()
      expect(text).toContain('Dev Server Not Running')
    })

    it('returns 426 for WebSocket upgrade requests', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: false })

      const res = await proxyApp.fetch(new Request('http://localhost/1/', {
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
        },
      }))
      expect(res.status).toBe(426)
      const body = await res.json() as Record<string, unknown>
      expect(body.error).toContain('WebSocket')
    })

    it('rewrites Vite client HMR websocket base to stay under the dev proxy prefix', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: false })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        'import "/node_modules/vite/dist/client/env.mjs"; const socketHost = `${__HMR_HOSTNAME__ || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/"}`',
        { headers: { 'content-type': 'application/javascript' } }
      )))

      const res = await proxyApp.fetch(new Request('http://localhost/1/@vite/client'))
      const text = await res.text()

      expect(text).toContain('${"/api/dev-proxy/1/"}')
      expect(text).toContain('import "/api/dev-proxy/1/node_modules/vite/dist/client/env.mjs"')
    })

    it('rewrites root absolute HTML paths even when base injection is disabled', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: false })
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        '<html><head><link href="/src/style.css" rel="stylesheet"></head><body><script type="module" src="/src/tetris.js"></script></body></html>',
        { headers: { 'content-type': 'text/html', etag: 'upstream-etag' } }
      ))
      vi.stubGlobal('fetch', fetchMock)

      const res = await proxyApp.fetch(new Request('http://localhost/1/', {
        headers: {
          'if-none-match': 'cached-etag',
          'if-modified-since': 'Sun, 21 Jun 2026 18:23:30 GMT',
        },
      }))
      const text = await res.text()
      const upstreamRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
      const upstreamHeaders = upstreamRequest.headers as Record<string, string>

      expect(text).toContain('href="/api/dev-proxy/1/src/style.css"')
      expect(text).toContain('src="/api/dev-proxy/1/src/tetris.js"')
      expect(text).not.toContain('<base href=')
      expect(upstreamHeaders['if-none-match']).toBeUndefined()
      expect(upstreamHeaders['if-modified-since']).toBeUndefined()
      expect(res.headers.get('etag')).toBeNull()
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('rewrites root absolute paths in CSS responses', async () => {
      vi.mocked(getDevServerConfig).mockReturnValue({ injectBase: false })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        '@import "/reset.css"; .hero{background:url(/assets/hero.png)}',
        { headers: { 'content-type': 'text/css', etag: 'css-etag' } }
      )))

      const res = await proxyApp.fetch(new Request('http://localhost/1/assets/app.css'))
      const text = await res.text()

      expect(text).toContain('@import "/api/dev-proxy/1/reset.css"')
      expect(text).toContain('url(/api/dev-proxy/1/assets/hero.png)')
      expect(res.headers.get('etag')).toBeNull()
      expect(res.headers.get('cache-control')).toBe('no-store')
    })
  })
})

describe('DevProxy HTML rewriting', () => {
  it('keeps absolute Vite module paths under the dev proxy prefix', () => {
    const html = '<html><head></head><body><script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script></body></html>'

    const rewritten = injectBaseTag(html, '/api/dev-proxy/1/')

    expect(rewritten).toContain('src="/api/dev-proxy/1/@vite/client"')
    expect(rewritten).toContain('src="/api/dev-proxy/1/src/main.tsx"')
  })

  it('rewrites absolute paths without injecting a base tag', () => {
    const html = '<html><head></head><body><script type="module" src="/src/tetris.js"></script></body></html>'

    const rewritten = rewriteDevProxyHtmlPaths(html, '/api/dev-proxy/1/')

    expect(rewritten).toContain('src="/api/dev-proxy/1/src/tetris.js"')
    expect(rewritten).not.toContain('<base href=')
  })

  it('keeps Vite HMR websocket paths under the dev proxy prefix', () => {
    const js = 'const socketHost = `${__HMR_HOSTNAME__ || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/"}`'

    const rewritten = rewriteViteClientHmrBase(js, '/api/dev-proxy/1/')

    expect(rewritten).toContain('${"/api/dev-proxy/1/"}')
  })

  it('keeps JavaScript module paths under the dev proxy prefix', () => {
    const js = 'import "/node_modules/vite/dist/client/env.mjs"; export { game } from "/src/game.js"; import("/src/lazy.js")'

    const rewritten = rewriteDevProxyJavaScriptPaths(js, '/api/dev-proxy/1/')

    expect(rewritten).toContain('import "/api/dev-proxy/1/node_modules/vite/dist/client/env.mjs"')
    expect(rewritten).toContain('from "/api/dev-proxy/1/src/game.js"')
    expect(rewritten).toContain('import("/api/dev-proxy/1/src/lazy.js")')
  })
})
