import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import path from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { storeMcpOAuthFlow, consumeMcpOAuthFlow, deleteMcpOAuthFlow, markMcpOAuthFlowCompleted, markMcpOAuthFlowFailed, getMcpOAuthFlowResult } from '../services/mcp-oauth-state'
import { logger } from '../utils/logger'
import { getWorkspacePath, ENV } from '@opencode-manager/shared/config/env'

const OPENCODE_SERVER_URL = `http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}`

const StartSchema = z.object({
  serverName: z.string(),
  serverUrl: z.string().url(),
  scope: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  directory: z.string().optional(),
})

function getMcpAuthPath(): string {
  return path.join(getWorkspacePath(), '.opencode/state/opencode/mcp-auth.json')
}

async function readMcpAuth(): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(getMcpAuthPath(), 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writeMcpAuth(data: Record<string, unknown>): Promise<void> {
  const filePath = getMcpAuthPath()
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
}

function generateState(): string {
  return crypto.randomBytes(32).toString('hex')
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return hash.toString('base64url')
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

async function discoverOAuthMetadata(serverUrl: string): Promise<{
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
} | undefined> {
  const url = new URL('/.well-known/oauth-authorization-server', serverUrl)
  try {
    const response = await fetch(url.toString(), {
      headers: { 'MCP-Protocol-Version': '2025-03-26' },
    })
    if (!response.ok) return undefined
    return await response.json() as {
      authorization_endpoint: string
      token_endpoint: string
      registration_endpoint?: string
    }
  } catch {
    return undefined
  }
}

async function registerClient(
  serverUrl: string,
  registrationEndpoint: string | undefined,
  callbackUrl: string,
  clientSecret?: string,
): Promise<{ client_id: string; client_secret?: string }> {
  const regUrl = registrationEndpoint || new URL('/register', serverUrl).toString()
  
  const response = await fetch(regUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [callbackUrl],
      client_name: 'OpenCode Manager',
      client_uri: 'https://opencode.ai',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: clientSecret ? 'client_secret_post' : 'none',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Dynamic client registration failed: ${response.status} ${text}`)
  }

  const result = await response.json() as { client_id: string; client_secret?: string }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMcpOauthProxyRoutes(requireAuth?: any) {
  const app = new Hono()

  if (requireAuth) {
    app.use('/start', requireAuth)
    app.use('/status/*', requireAuth)
  }

  app.post('/start', async (c) => {
    try {
      const body = await c.req.json()
      const { serverName, serverUrl, scope, clientId, clientSecret, directory } = StartSchema.parse(body)

      const origin = c.req.header('x-forwarded-proto') && c.req.header('host')
        ? `${c.req.header('x-forwarded-proto')}://${c.req.header('host')}`
        : c.req.header('origin') || `http://${c.req.header('host') || 'localhost:5003'}`
      const callbackUrl = `${origin}/api/mcp-oauth-proxy/callback`

      const metadata = await discoverOAuthMetadata(serverUrl)
      if (!metadata) {
        return c.json({ error: 'OAuth metadata discovery failed for this MCP server' }, 400)
      }

      let resolvedClientId = clientId
      let resolvedClientSecret = clientSecret

      if (!resolvedClientId) {
        if (!metadata.registration_endpoint) {
          return c.json({ error: 'Server does not support dynamic client registration and no clientId provided' }, 400)
        }
        const registered = await registerClient(serverUrl, metadata.registration_endpoint, callbackUrl, clientSecret)
        resolvedClientId = registered.client_id
        resolvedClientSecret = registered.client_secret
        logger.info(`Registered OAuth client for ${serverName}: ${resolvedClientId}`)
      }

      const state = generateState()
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      storeMcpOAuthFlow(state, {
        serverName,
        serverUrl,
        codeVerifier,
        clientId: resolvedClientId,
        clientSecret: resolvedClientSecret,
        callbackUrl,
        tokenEndpoint: metadata.token_endpoint,
        directory,
      })

      const authUrl = new URL(metadata.authorization_endpoint)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', resolvedClientId)
      authUrl.searchParams.set('redirect_uri', callbackUrl)
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      if (scope) {
        authUrl.searchParams.set('scope', scope)
      }

      return c.json({ authorizationUrl: authUrl.toString(), flowId: state })
    } catch (error) {
      logger.error('MCP OAuth start failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to start OAuth flow'
      return c.json({ error: message }, 500)
    }
  })

  app.get('/status/:flowId', async (c) => {
    const flowId = c.req.param('flowId')
    const result = getMcpOAuthFlowResult(flowId)
    if (!result) {
      return c.json({ status: 'unknown' })
    }
    return c.json(result)
  })

  app.get('/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')
    const errorDescription = c.req.query('error_description')

    if (!state) {
      return c.html(renderPage('Missing State', 'No state parameter. Please try again.', false), 400)
    }

    if (error) {
      markMcpOAuthFlowFailed(state, errorDescription || error)
      deleteMcpOAuthFlow(state)
      return c.html(renderPage('Authorization Failed', errorDescription || error, false), 400)
    }

    if (!code) {
      markMcpOAuthFlowFailed(state, 'No authorization code received')
      deleteMcpOAuthFlow(state)
      return c.html(renderPage('Missing Code', 'No authorization code. Please try again.', false), 400)
    }

    const flow = consumeMcpOAuthFlow(state)
    if (!flow) {
      return c.html(renderPage('Session Expired', 'Authorization session expired. Please try again.', false), 400)
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: flow.clientId,
        code,
        code_verifier: flow.codeVerifier,
        redirect_uri: flow.callbackUrl,
      })
      if (flow.clientSecret) {
        params.set('client_secret', flow.clientSecret)
      }

      const tokenResponse = await fetch(flow.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      })

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text()
        logger.error(`Token exchange failed for ${flow.serverName}: ${tokenResponse.status} ${errText}`)
        markMcpOAuthFlowFailed(state, 'Token exchange failed')
        return c.html(renderPage('Token Exchange Failed', 'Failed to exchange code for tokens. Please try again.', false), 500)
      }

      const tokens = await tokenResponse.json() as {
        access_token: string
        refresh_token?: string
        expires_in?: number
        scope?: string
        token_type?: string
      }

      const authData = await readMcpAuth()
      authData[flow.serverName] = {
        ...(authData[flow.serverName] as Record<string, unknown> || {}),
        serverUrl: flow.serverUrl,
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : undefined,
          scope: tokens.scope,
        },
        clientInfo: {
          clientId: flow.clientId,
          clientSecret: flow.clientSecret,
        },
      }
      await writeMcpAuth(authData)
      logger.info(`Wrote OAuth tokens to mcp-auth.json for ${flow.serverName}`)
      markMcpOAuthFlowCompleted(state, flow.serverName)

      try {
        let reconnectUrl = `${OPENCODE_SERVER_URL}/mcp/${encodeURIComponent(flow.serverName)}/connect`
        if (flow.directory) {
          const url = new URL(reconnectUrl)
          url.searchParams.set('directory', flow.directory)
          reconnectUrl = url.toString()
        }
        await fetch(reconnectUrl, {
          method: 'POST',
        })
        if (flow.directory) {
          const globalReconnectUrl = `${OPENCODE_SERVER_URL}/mcp/${encodeURIComponent(flow.serverName)}/connect`
          await fetch(globalReconnectUrl, {
            method: 'POST',
          })
        }
      } catch {
        logger.warn(`Failed to trigger reconnect for ${flow.serverName}, may need manual reconnect`)
      }

      return c.html(renderPage('Authentication Successful', 'You can close this window now.', true))
    } catch (err) {
      logger.error('MCP OAuth callback failed:', err)
      markMcpOAuthFlowFailed(state, 'Unexpected error during token exchange')
      return c.html(renderPage('Unexpected Error', 'An error occurred. Please try again.', false), 500)
    }
  })

  return app
}
