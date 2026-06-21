import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { Database } from 'bun:sqlite'
import net from 'net'
import type { AuthInstance } from '../../auth'
import { getDevServerPort } from './manager'
import { parseDevProxyPath } from './proxy-utils'
import { logger } from '../../utils/logger'

export function buildUpstreamUpgradeRequest(rawHead: string, rest: string, port: number): string {
  const lines = rawHead.split('\r\n')
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) return rawHead

  const requestLine = lines[0]!
  const parts = requestLine.split(' ')
  const rewrittenLine = `${parts[0]} ${rest} ${parts.slice(2).join(' ')}`

  const result: string[] = [rewrittenLine]

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1) {
      const headerName = line.slice(0, colonIdx).trim().toLowerCase()
      if (headerName === 'host') continue
    }
    result.push(line)
  }

  result.push(`Host: 127.0.0.1:${port}`)

  return result.join('\r\n')
}

function nodeHeadersToWebHeaders(reqHeaders: IncomingMessage['headers']): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v)
        }
      } else {
        headers.set(key, value)
      }
    }
  }
  return headers
}

export function createDevProxyUpgradeHandler(auth: AuthInstance, db: Database) {
  return async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      const url = req.url ?? ''
      const parsed = parseDevProxyPath(url)
      if (!parsed) {
        socket.destroy()
        return
      }

      const headers = nodeHeadersToWebHeaders(req.headers)
      let session
      try {
        session = await auth.api.getSession({ headers })
      } catch {
        socket.destroy()
        return
      }

      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
        socket.destroy()
        return
      }

      const port = getDevServerPort(db)

      const rawHeadLines: string[] = [`${req.method} ${req.url} HTTP/1.1`]
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            for (const v of value) {
              rawHeadLines.push(`${key}: ${v}`)
            }
          } else {
            rawHeadLines.push(`${key}: ${value}`)
          }
        }
      }
      const rawHead = rawHeadLines.join('\r\n')

      const upstreamRequest = buildUpstreamUpgradeRequest(rawHead, parsed.rest, port)

      const upstream = net.connect(port, '127.0.0.1')

      upstream.on('connect', () => {
        upstream.write(upstreamRequest + '\r\n\r\n')
        if (head.length > 0) {
          upstream.write(head)
        }
        socket.pipe(upstream)
        upstream.pipe(socket)
      })

      upstream.on('error', () => {
        socket.destroy()
      })

      socket.on('error', () => {
        upstream.destroy()
      })

      socket.on('close', () => {
        upstream.destroy()
      })

      upstream.on('close', () => {
        socket.destroy()
      })
    } catch (error) {
      logger.error('Dev proxy upgrade handler error:', error)
      socket.destroy()
    }
  }
}
