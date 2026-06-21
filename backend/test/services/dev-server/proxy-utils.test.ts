import { describe, it, expect } from 'vitest'
import {
  DEV_PROXY_PREFIX,
  parseDevProxyPath,
  buildUpstreamUrl,
  filterProxyHeaders,
  sanitizeUpstreamResponseHeaders,
  isWebSocketUpgrade,
  injectBaseTag,
  rewriteDevProxyCssPaths,
  rewriteDevProxyHtmlPaths,
  rewriteDevProxyJavaScriptPaths,
} from '../../../src/services/dev-server/proxy-utils'

describe('DEV_PROXY_PREFIX', () => {
  it('is /api/dev-proxy', () => {
    expect(DEV_PROXY_PREFIX).toBe('/api/dev-proxy')
  })
})

describe('parseDevProxyPath', () => {
  it('parses path with repo id and subpath', () => {
    const result = parseDevProxyPath('/api/dev-proxy/12/assets/x.js')
    expect(result).toEqual({ repoId: 12, rest: '/assets/x.js' })
  })

  it('parses path with only repo id', () => {
    const result = parseDevProxyPath('/api/dev-proxy/12')
    expect(result).toEqual({ repoId: 12, rest: '/' })
  })

  it('parses path with repo id and trailing slash', () => {
    const result = parseDevProxyPath('/api/dev-proxy/12/')
    expect(result).toEqual({ repoId: 12, rest: '/' })
  })

  it('returns null for path without dev-proxy prefix', () => {
    expect(parseDevProxyPath('/api/files')).toBeNull()
  })

  it('returns null for path with non-numeric repo id', () => {
    expect(parseDevProxyPath('/api/dev-proxy/abc')).toBeNull()
  })

  it('returns null when repo id segment is empty', () => {
    expect(parseDevProxyPath('/api/dev-proxy/')).toBeNull()
  })

  it('returns null for unrelated path', () => {
    expect(parseDevProxyPath('/api/other/12/file.js')).toBeNull()
  })

  it('parses multi-digit port numbers', () => {
    const result = parseDevProxyPath('/api/dev-proxy/12345/assets')
    expect(result).toEqual({ repoId: 12345, rest: '/assets' })
  })

  it('parses path with special characters in rest', () => {
    const result = parseDevProxyPath('/api/dev-proxy/1/@fs/src/main.tsx')
    expect(result).toEqual({ repoId: 1, rest: '/@fs/src/main.tsx' })
  })
})

describe('buildUpstreamUrl', () => {
  it('builds url with search params', () => {
    const result = buildUpstreamUrl(5173, '/assets/x.js', '?v=1')
    expect(result).toBe('http://127.0.0.1:5173/assets/x.js?v=1')
  })

  it('builds url without search params', () => {
    const result = buildUpstreamUrl(5173, '/', '')
    expect(result).toBe('http://127.0.0.1:5173/')
  })

  it('builds url with query string', () => {
    const result = buildUpstreamUrl(3000, '/api/data', '?foo=bar&baz=1')
    expect(result).toBe('http://127.0.0.1:3000/api/data?foo=bar&baz=1')
  })

  it('uses 127.0.0.1 as hostname', () => {
    const result = buildUpstreamUrl(8080, '/', '')
    expect(result).toMatch(/^http:\/\/127\.0\.0\.1:/)
  })
})

describe('filterProxyHeaders', () => {
  it('removes hop-by-hop headers', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'connection': 'keep-alive',
      'upgrade': 'websocket',
      'cache-control': 'no-cache',
    })
    const result = filterProxyHeaders(headers)
    expect(result).toHaveProperty('content-type')
    expect(result).toHaveProperty('cache-control')
    expect(result).not.toHaveProperty('connection')
    expect(result).not.toHaveProperty('upgrade')
  })

  it('removes all hop-by-hop headers case-insensitively', () => {
    const headers = new Headers({
      'Connection': 'close',
      'Transfer-Encoding': 'chunked',
      'Content-Length': '100',
      'Host': 'example.com',
    })
    const result = filterProxyHeaders(headers)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('preserves non-hop-by-hop headers', () => {
    const headers = new Headers({
      'accept': 'application/json',
      'user-agent': 'test',
      'referer': 'http://example.com',
    })
    const result = filterProxyHeaders(headers)
    expect(result).toHaveProperty('accept')
    expect(result).toHaveProperty('user-agent')
    expect(result).toHaveProperty('referer')
  })

  it('returns empty object for empty headers', () => {
    const result = filterProxyHeaders(new Headers())
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('sanitizeUpstreamResponseHeaders', () => {
  it('strips hop-by-hop headers', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'connection': 'keep-alive',
      'x-frame-options': 'DENY',
    })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result).toHaveProperty('content-type')
    expect(result).not.toHaveProperty('connection')
  })

  it('removes x-frame-options', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'x-frame-options': 'DENY',
    })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result).not.toHaveProperty('x-frame-options')
  })

  it('removes content-security-policy', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'",
    })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result).not.toHaveProperty('content-security-policy')
  })

  it('handles case-insensitive blocked header names', () => {
    const headers = new Headers({
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'",
    })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result).not.toHaveProperty('X-Frame-Options')
    expect(result).not.toHaveProperty('Content-Security-Policy')
  })

  it('adds referrer-policy: no-referrer', () => {
    const headers = new Headers({ 'content-type': 'text/plain' })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result['referrer-policy']).toBe('no-referrer')
  })

  it('overwrites upstream referrer-policy', () => {
    const headers = new Headers({
      'referrer-policy': 'origin',
    })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result['referrer-policy']).toBe('no-referrer')
  })

  it('preserves allowed headers', () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'cache-control': 'public',
      'etag': '"abc123"',
    })
    const result = sanitizeUpstreamResponseHeaders(headers)
    expect(result).toHaveProperty('content-type')
    expect(result).toHaveProperty('cache-control')
    expect(result).toHaveProperty('etag')
  })
})

describe('isWebSocketUpgrade', () => {
  it('returns true for websocket upgrade', () => {
    const headerGet = (k: string) =>
      ({ connection: 'Upgrade', upgrade: 'websocket' })[k]
    expect(isWebSocketUpgrade(headerGet)).toBe(true)
  })

  it('handles case-insensitive connection header', () => {
    const headerGet = (k: string) =>
      ({ connection: 'upgrade', upgrade: 'websocket' })[k]
    expect(isWebSocketUpgrade(headerGet)).toBe(true)
  })

  it('returns false when connection does not include upgrade', () => {
    const headerGet = (k: string) =>
      ({ connection: 'keep-alive', upgrade: 'websocket' })[k]
    expect(isWebSocketUpgrade(headerGet)).toBe(false)
  })

  it('returns false when upgrade is not websocket', () => {
    const headerGet = (k: string) =>
      ({ connection: 'Upgrade', upgrade: 'h2c' })[k]
    expect(isWebSocketUpgrade(headerGet)).toBe(false)
  })

  it('returns false when both headers are missing', () => {
    const headerGet = () => undefined
    expect(isWebSocketUpgrade(headerGet)).toBe(false)
  })

  it('returns false when connection header is missing', () => {
    const headerGet = (k: string) =>
      ({ upgrade: 'websocket' })[k]
    expect(isWebSocketUpgrade(headerGet)).toBe(false)
  })

  it('returns false when upgrade header is missing', () => {
    const headerGet = (k: string) =>
      ({ connection: 'Upgrade' })[k]
    expect(isWebSocketUpgrade(headerGet)).toBe(false)
  })
})

describe('injectBaseTag', () => {
  it('injects base tag after <head>', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectBaseTag(html, '/api/dev-proxy/3/')
    expect(result).toBe('<html><head><base href="/api/dev-proxy/3/"></head><body></body></html>')
  })

  it('injects base tag after <head> with attributes', () => {
    const html = '<html><head lang="en"></head><body></body></html>'
    const result = injectBaseTag(html, '/api/dev-proxy/3/')
    expect(result).toBe('<html><head lang="en"><base href="/api/dev-proxy/3/"></head><body></body></html>')
  })

  it('is no-op when <base> already present', () => {
    const html = '<html><head><base href="/"></head><body></body></html>'
    const result = injectBaseTag(html, '/api/dev-proxy/3/')
    expect(result).toBe(html)
  })

  it('is no-op when no <head> tag exists', () => {
    const html = '<html><body>no head</body></html>'
    const result = injectBaseTag(html, '/api/dev-proxy/3/')
    expect(result).toBe(html)
  })

  it('handles uppercase HEAD tag', () => {
    const html = '<HTML><HEAD></HEAD><BODY></BODY></HTML>'
    const result = injectBaseTag(html, '/proxy/')
    expect(result).toBe('<HTML><HEAD><base href="/proxy/"></HEAD><BODY></BODY></HTML>')
  })

  it('injects after <head> with newline after', () => {
    const html = '<html><head>\n  <title>Test</title>\n</head>'
    const result = injectBaseTag(html, '/base/')
    expect(result).toBe('<html><head><base href="/base/">\n  <title>Test</title>\n</head>')
  })

  it('does not inject when <base> appears in non-head context (e.g. body)', () => {
    const html = '<html><head></head><body><base href="/bad"></body></html>'
    const result = injectBaseTag(html, '/base/')
    expect(result).toBe(html)
  })

  it('handles empty string', () => {
    const result = injectBaseTag('', '/base/')
    expect(result).toBe('')
  })
})

describe('dev proxy path rewriting', () => {
  it('rewrites common framework HTML asset paths', () => {
    const html = '<img src="/_next/image.png"><source srcset="/assets/a.png 1x, /static/b.png 2x"><form action="/api/action"></form>'

    const result = rewriteDevProxyHtmlPaths(html, '/api/dev-proxy/7/')

    expect(result).toContain('src="/api/dev-proxy/7/_next/image.png"')
    expect(result).toContain('srcset="/api/dev-proxy/7/assets/a.png 1x, /api/dev-proxy/7/static/b.png 2x"')
    expect(result).toContain('action="/api/dev-proxy/7/api/action"')
  })

  it('rewrites CSS paths in HTML style content', () => {
    const html = '<div style="background:url(/assets/bg.png)"></div><style>@import "/theme.css"; body{background:url("/img/bg.svg")}</style>'

    const result = rewriteDevProxyHtmlPaths(html, '/api/dev-proxy/7/')

    expect(result).toContain('url(/api/dev-proxy/7/assets/bg.png)')
    expect(result).toContain('@import "/api/dev-proxy/7/theme.css"')
    expect(result).toContain('url("/api/dev-proxy/7/img/bg.svg")')
  })

  it('rewrites CSS response paths', () => {
    const css = '@import "/reset.css"; .hero{background:url(/assets/hero.png)} .icon{mask:url("/icons/x.svg")}'

    const result = rewriteDevProxyCssPaths(css, '/api/dev-proxy/7/')

    expect(result).toContain('@import "/api/dev-proxy/7/reset.css"')
    expect(result).toContain('url(/api/dev-proxy/7/assets/hero.png)')
    expect(result).toContain('url("/api/dev-proxy/7/icons/x.svg")')
  })

  it('rewrites JavaScript module paths', () => {
    const js = 'import "/runtime.js"; export { App } from "/src/App.js"; const route = import("/routes/home.js")'

    const result = rewriteDevProxyJavaScriptPaths(js, '/api/dev-proxy/7/')

    expect(result).toContain('import "/api/dev-proxy/7/runtime.js"')
    expect(result).toContain('from "/api/dev-proxy/7/src/App.js"')
    expect(result).toContain('import("/api/dev-proxy/7/routes/home.js")')
  })

  it('does not rewrite protocol-relative or already proxied paths', () => {
    const html = '<script src="//cdn.example.com/app.js"></script><script src="/api/dev-proxy/7/src/app.js"></script>'

    const result = rewriteDevProxyHtmlPaths(html, '/api/dev-proxy/7/')

    expect(result).toBe(html)
  })
})
