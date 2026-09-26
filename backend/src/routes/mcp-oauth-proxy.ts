import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import {
  MCP_OAUTH_CALLBACK_PATH,
  mcpOAuthRedirectUri,
  mcpServersFromConfig,
  openCodeLocation,
} from '@opencode-manager/shared/opencode'
import type { McpServerConfig } from '@opencode-manager/shared/opencode'
import { ENV } from '@opencode-manager/shared/config/env'
import type { OpenCodeClient } from '../services/opencode/client'
import { storeMcpOAuthFlow, consumeMcpOAuthFlow, getMcpOAuthFlowByAttempt } from '../services/mcp-oauth-state'
import { logger } from '../utils/logger'

const StartSchema = z.object({
  serverName: z.string().min(1),
  directory: z.string().optional(),
})

const DirectoryQuerySchema = z.object({
  directory: z.string().optional(),
})

function firstHeaderValue(c: Context, name: string): string | undefined {
  const value = c.req.header(name)?.split(',')[0]?.trim()
  return value || undefined
}

function forwardedScheme(c: Context): 'http' | 'https' | undefined {
  const proto = firstHeaderValue(c, 'x-forwarded-proto')?.toLowerCase()
  return proto === 'http' || proto === 'https' ? proto : undefined
}

function requestOrigin(c: Context): string {
  const host = firstHeaderValue(c, 'x-forwarded-host') ?? c.req.header('host') ?? 'localhost:5003'
  const scheme = forwardedScheme(c)
  if (scheme) return `${scheme}://${host}`
  return c.req.header('origin') || `http://${host}`
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderPage(heading: string, message: string, isSuccess: boolean): string {
  const color = isSuccess ? '#4ade80' : '#f87171'
  return `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(heading)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    h2 { color: ${color}; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.9rem; }
  </style>
  ${isSuccess ? '<script>setTimeout(() => window.close(), 2000);</script>' : ''}
</head>
<body>
  <div class="container">
    <h2>${escapeHtml(heading)}</h2>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`
}

function probeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

export function createMcpOauthProxyRoutes(openCodeClient: OpenCodeClient, requireAuth?: MiddlewareHandler) {
  if (ENV.OPENCODE.LEGACY_PUBLIC_URL) {
    logger.warn('OPENCODE_PUBLIC_URL is set but no longer used; MCP OAuth redirects are derived from X-Forwarded-Proto/X-Forwarded-Host, Origin, or Host')
  }

  const app = new Hono()
  const api = openCodeClient.api

  const findServer = async (serverName: string, directory: string | undefined) => {
    const servers = (await api.mcp.list(openCodeLocation(directory))).data
    return servers.find((server) => server.name === serverName)
  }

  const readServerConfig = async (serverName: string, directory: string | undefined) => {
    const entries = await api.config.get(openCodeLocation(directory))
    let config: McpServerConfig | undefined
    for (const entry of entries) {
      if (entry.type !== 'document') continue
      config = mcpServersFromConfig(entry.info.mcp)[serverName] ?? config
    }
    return config
  }

  const cancelAttempt = async (integrationID: string, attemptID: string, directory: string | undefined) => {
    try {
      await api.integration.oauth.cancel({ integrationID, attemptID, ...openCodeLocation(directory) })
    } catch (error) {
      logger.warn(`Failed to cancel MCP OAuth attempt ${attemptID}:`, error)
    }
  }

  // V2 binds the redirect URI's port on the OpenCode host's loopback for the lifetime of an attempt, so
  // the Manager's own port would collide. Re-add the server on a free loopback port before connecting;
  // the browser still reaches the Manager because the redirect URI stays the Manager's callback.
  const reserveCallbackPort = async (server: { name: string; integrationID?: string }, origin: string, directory: string | undefined) => {
    const port = await probeLoopbackPort()
    if (!server.integrationID) return port

    try {
      const v2Config = await readServerConfig(server.name, directory)
      if (!v2Config || v2Config.type !== 'remote') return port

      await api.mcp.add({
        server: server.name,
        ...openCodeLocation(directory),
        config: {
          ...v2Config,
          oauth: {
            ...(v2Config.oauth === false ? {} : v2Config.oauth ?? {}),
            redirect_uri: mcpOAuthRedirectUri(origin),
            callback_port: port,
          },
        },
      })
    } catch (error) {
      logger.warn(`Failed to reserve a loopback callback port for ${server.name}:`, error)
    }
    return port
  }

  if (requireAuth) {
    app.use('/start', requireAuth)
    app.use('/status/*', requireAuth)
    app.use('/credentials/*', requireAuth)
  }

  app.post('/start', async (c) => {
    try {
      const { serverName, directory } = StartSchema.parse(await c.req.json())

      const server = await findServer(serverName, directory)
      if (!server) {
        return c.json({ error: 'MCP server not found' }, 404)
      }
      if (!server.integrationID) {
        return c.json({ error: 'MCP server is not registered for OAuth' }, 400)
      }

      const callbackPort = await reserveCallbackPort(server, requestOrigin(c), directory)

      const integration = (await api.integration.get({ integrationID: server.integrationID, ...openCodeLocation(directory) })).data
      const method = integration.methods.find((candidate) => candidate.type === 'oauth')
      if (!method) {
        return c.json({ error: 'OAuth method not found for this MCP server' }, 400)
      }

      const attempt = (
        await api.integration.oauth.connect({
          integrationID: server.integrationID,
          methodID: method.id,
          ...openCodeLocation(directory),
        })
      ).data

      const state = new URL(attempt.url).searchParams.get('state')
      if (!state) {
        return c.json({ error: 'Authorization URL is missing the state parameter' }, 500)
      }

      storeMcpOAuthFlow({
        state,
        serverName,
        integrationID: server.integrationID,
        attemptID: attempt.attemptID,
        directory,
        callbackPort,
      })

      return c.json({ authorizationUrl: attempt.url, flowId: attempt.attemptID })
    } catch (error) {
      logger.error('MCP OAuth start failed:', error)
      return c.json({ error: 'Failed to start OAuth flow' }, 500)
    }
  })

  app.get('/status/:flowId', async (c) => {
    const attemptID = c.req.param('flowId')
    const flow = getMcpOAuthFlowByAttempt(attemptID)
    if (!flow) {
      return c.json({ status: 'unknown' })
    }

    try {
      const attempt = (
        await api.integration.oauth.status({
          integrationID: flow.integrationID,
          attemptID: flow.attemptID,
          ...openCodeLocation(flow.directory),
        })
      ).data

      if (attempt.status === 'complete') {
        return c.json({ status: 'completed', serverName: flow.serverName })
      }
      if (attempt.status === 'failed') {
        return c.json({ status: 'failed', error: attempt.message })
      }
      if (attempt.status === 'expired') {
        return c.json({ status: 'failed', error: 'Authorization expired' })
      }
      return c.json({ status: 'pending' })
    } catch (error) {
      logger.error('MCP OAuth status lookup failed:', error)
      return c.json({ status: 'unknown' })
    }
  })

  app.get('/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    const issuer = c.req.query('iss')
    const error = c.req.query('error')
    const errorDescription = c.req.query('error_description')

    if (!state) {
      return c.html(renderPage('Missing State', 'No state parameter. Please try again.', false), 400)
    }

    const flow = consumeMcpOAuthFlow(state)
    if (!flow) {
      return c.html(renderPage('Session Expired', 'Authorization session expired. Please try again.', false), 400)
    }

    if (error) {
      await cancelAttempt(flow.integrationID, flow.attemptID, flow.directory)
      return c.html(renderPage('Authorization Failed', errorDescription || error, false), 400)
    }

    if (!code) {
      await cancelAttempt(flow.integrationID, flow.attemptID, flow.directory)
      return c.html(renderPage('Missing Code', 'No authorization code. Please try again.', false), 400)
    }

    try {
      // Hand the code to the OpenCode host's loopback listener, which owns PKCE, the token exchange,
      // and the credential; the Manager only relays the browser's redirect.
      const callbackUrl = new URL(MCP_OAUTH_CALLBACK_PATH, `http://127.0.0.1:${flow.callbackPort}`)
      callbackUrl.searchParams.set('code', code)
      callbackUrl.searchParams.set('state', state)
      if (issuer) callbackUrl.searchParams.set('iss', issuer)

      const response = await fetch(callbackUrl)
      if (!response.ok) {
        logger.warn(`MCP OAuth callback was rejected for ${flow.serverName}: ${response.status}`)
        return c.html(renderPage('Authentication Failed', 'Failed to complete authorization. Please try again.', false), 400)
      }

      return c.html(renderPage('Authentication Successful', 'You can close this window now.', true))
    } catch (forwardError) {
      logger.error('MCP OAuth callback forward failed:', forwardError)
      return c.html(renderPage('Authentication Failed', 'Failed to complete authorization. Please try again.', false), 500)
    }
  })

  app.delete('/credentials/:serverName', async (c) => {
    try {
      const serverName = c.req.param('serverName')
      const { directory } = DirectoryQuerySchema.parse(c.req.query())

      const server = await findServer(serverName, directory)
      if (!server?.integrationID) {
        return c.json({ success: true })
      }

      const integration = (await api.integration.get({ integrationID: server.integrationID, ...openCodeLocation(directory) })).data
      for (const connection of integration.connections) {
        if (connection.type === 'credential') {
          await api.credential.remove({ credentialID: connection.id })
        }
      }

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to remove MCP credentials:', error)
      return c.json({ error: 'Failed to remove MCP credentials' }, 500)
    }
  })

  return app
}
