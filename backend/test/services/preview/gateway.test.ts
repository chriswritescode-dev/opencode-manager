import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import {
  createPreviewGatewayApp,
  PreviewSessionStore,
  PREVIEW_COOKIE,
} from '../../../src/services/preview/gateway'

let upstreamServer: Server
let upstreamPort = 0

const upstreamApp = new Hono()

upstreamApp.post('/gzip', async (c) => {
  const encoding = c.req.header('content-encoding') ?? null
  const bytes = Buffer.from(await c.req.arrayBuffer())
  const decoded = encoding === 'gzip' ? gunzipSync(bytes).toString('utf8') : null
  return c.json({ encoding, decoded })
})

upstreamApp.get('/cookies', () => {
  const headers = new Headers()
  headers.append('set-cookie', 'session=abc; Path=/; HttpOnly')
  headers.append('set-cookie', 'csrf=def; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT')
  headers.set('content-type', 'text/plain')
  return new Response('ok', { status: 200, headers })
})

upstreamApp.get('/manager-cookies', () => {
  const headers = new Headers()
  headers.append('set-cookie', 'app=keep; Path=/')
  headers.append('set-cookie', `${PREVIEW_COOKIE}=upstream; Path=/`)
  headers.append('set-cookie', 'opencode.session_token=secret; Path=/')
  headers.append('set-cookie', '__Secure-opencode.session_token=secure; Path=/')
  headers.append('set-cookie', '__Host-opencode.session_token=host; Path=/')
  headers.set('content-type', 'text/plain')
  return new Response('ok', { status: 200, headers })
})

upstreamApp.get('/redirect', (c) => c.redirect(c.req.query('to') ?? '/', 302))

upstreamApp.all('/*', async (c) => {
  if (c.req.path === '/r') {
    return c.redirect(`http://localhost:${upstreamPort}/done`, 302)
  }
  const body = c.req.method === 'GET' || c.req.method === 'HEAD' ? '' : await c.req.text()
  return c.json({
    method: c.req.method,
    path: c.req.path,
    search: new URL(c.req.url).search,
    host: c.req.header('host') ?? null,
    cookie: c.req.header('cookie') ?? null,
    acceptEncoding: c.req.header('accept-encoding') ?? null,
    body,
  })
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve((server.address() as AddressInfo).port)
      return
    }
    server.once('listening', () => resolve((server.address() as AddressInfo).port))
  })
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

function reserveClosedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

function previewCookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected a Set-Cookie header')
  return setCookie.split(';')[0]!
}

async function openSession(app: Hono, store: PreviewSessionStore, port: number): Promise<string> {
  const token = store.issueStartToken({ port, host: '127.0.0.1' })
  const res = await app.request(
    `http://localhost/__ocm_preview/start?token=${encodeURIComponent(token)}`,
    { redirect: 'manual' },
  )
  return previewCookieFrom(res)
}

beforeAll(async () => {
  upstreamServer = serve({ fetch: upstreamApp.fetch, port: 0, hostname: '127.0.0.1' }) as unknown as Server
  upstreamPort = await listen(upstreamServer)
})

afterAll(async () => {
  await closeServer(upstreamServer)
})

describe('Preview Gateway', () => {
  it('consumes the start token, sets the preview cookie, and redirects to the given path', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })

    const res = await app.request(
      `http://localhost/__ocm_preview/start?token=${token}&path=${encodeURIComponent('/app?x=1')}`,
      { redirect: 'manual' },
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/app?x=1')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${PREVIEW_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
  })

  it('redirects a protocol-relative path to the root', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })

    const res = await app.request(
      `http://localhost/__ocm_preview/start?token=${token}&path=${encodeURIComponent('//evil.example')}`,
      { redirect: 'manual' },
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
  })

  it('rejects redirect paths that resolve off-origin', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app

    for (const malicious of ['/\\evil.example', '//evil.example', 'https://evil.example']) {
      const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })
      const res = await app.request(
        `http://localhost/__ocm_preview/start?token=${token}&path=${encodeURIComponent(malicious)}`,
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/')
    }
  })

  it('redirects to an allowed same-origin path with query and hash', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })

    const res = await app.request(
      `http://localhost/__ocm_preview/start?token=${token}&path=${encodeURIComponent('/ok?x=1#h')}`,
      { redirect: 'manual' },
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/ok?x=1#h')
  })

  it('does not allow a start token to be reused', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })

    const first = await app.request(`http://localhost/__ocm_preview/start?token=${token}`, { redirect: 'manual' })
    expect(first.status).toBe(302)

    const second = await app.request(`http://localhost/__ocm_preview/start?token=${token}`, { redirect: 'manual' })
    expect(second.status).toBe(401)
  })

  it('rejects an expired start token', async () => {
    let now = 1_000
    const store = new PreviewSessionStore({ now: () => now, randomToken: () => 'expired-token' })
    const app = createPreviewGatewayApp(store).app
    const token = store.issueStartToken({ port: upstreamPort, host: '127.0.0.1' })

    now += 61_000

    const res = await app.request(`http://localhost/__ocm_preview/start?token=${token}`, { redirect: 'manual' })
    expect(res.status).toBe(401)
  })

  it('rejects a request without a preview cookie', async () => {
    const app = createPreviewGatewayApp(new PreviewSessionStore()).app

    const res = await app.request('http://localhost/anything')

    expect(res.status).toBe(401)
  })

  it('proxies with the localhost host header and strips Manager cookies', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const res = await app.request('http://localhost/echo?q=1', {
      headers: { cookie: `${cookie}; user=abc; opencode.session_token=secret` },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { method: string; path: string; search: string; host: string; cookie: string }
    expect(body.method).toBe('GET')
    expect(body.path).toBe('/echo')
    expect(body.search).toBe('?q=1')
    expect(body.host).toBe(`localhost:${upstreamPort}`)
    expect(body.cookie).toBe('user=abc')
  })

  it('forwards a POST body', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const res = await app.request('http://localhost/echo', {
      method: 'POST',
      headers: { cookie },
      body: 'hello preview',
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { method: string; body: string }
    expect(body.method).toBe('POST')
    expect(body.body).toBe('hello preview')
  })

  it('forwards a gzip-encoded request body together with its content-encoding', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const payload = 'compressed telemetry payload'
    const gzipped = gzipSync(Buffer.from(payload, 'utf8'))

    const res = await app.request('http://localhost/gzip', {
      method: 'POST',
      headers: { cookie, 'content-encoding': 'gzip', 'content-type': 'application/json' },
      body: gzipped,
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { encoding: string | null; decoded: string | null }
    expect(body.encoding).toBe('gzip')
    expect(body.decoded).toBe(payload)
  })

  it('forwards every upstream Set-Cookie value separately and intact', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const res = await app.request('http://localhost/cookies', { headers: { cookie } })

    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toContain('session=abc; Path=/; HttpOnly')
    expect(cookies).toContain('csrf=def; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT')
    expect(cookies).toHaveLength(2)
  })

  it('drops Manager and preview Set-Cookie values from upstream responses', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const res = await app.request('http://localhost/manager-cookies', { headers: { cookie } })

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual(['app=keep; Path=/'])
  })

  it('requests identity encoding from the upstream', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const res = await app.request('http://localhost/echo', {
      headers: { cookie, 'accept-encoding': 'gzip, br' },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { acceptEncoding: string | null }
    expect(body.acceptEncoding).toBe('identity')
  })

  it('rewrites an absolute localhost location to its path', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    const res = await app.request('http://localhost/r', {
      headers: { cookie },
      redirect: 'manual',
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/done')
  })

  it('rewrites loopback locations beyond 127.0.0.1 and IPv6 loopback locations to their path', async () => {
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, upstreamPort)

    for (const host of ['127.0.0.2', '[::1]']) {
      const target = `http://${host}:${upstreamPort}/wide?x=1`
      const res = await app.request(
        `http://localhost/redirect?to=${encodeURIComponent(target)}`,
        { headers: { cookie }, redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/wide?x=1')
    }
  })

  it('returns 502 when the target port is unreachable', async () => {
    const closedPort = await reserveClosedPort()
    const store = new PreviewSessionStore()
    const app = createPreviewGatewayApp(store).app
    const cookie = await openSession(app, store, closedPort)

    const res = await app.request('http://localhost/anything', { headers: { cookie } })

    expect(res.status).toBe(502)
    expect(await res.text()).toContain(String(closedPort))
  })
})
