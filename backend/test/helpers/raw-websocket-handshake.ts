import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'

export interface RawHandshakeResult {
  upgraded: boolean
  status?: number
}

export function rawWebSocketHandshake(options: {
  port: number
  path: string
  origin?: string
  cookie?: string
}): Promise<RawHandshakeResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version': '13',
    }
    if (options.origin !== undefined) headers.Origin = options.origin
    if (options.cookie) headers.Cookie = options.cookie

    const request = httpRequest({ host: '127.0.0.1', port: options.port, path: options.path, method: 'GET', headers })
    let settled = false
    request.on('upgrade', (_res, socket) => {
      settled = true
      socket.destroy()
      resolve({ upgraded: true })
    })
    request.on('response', (res) => {
      settled = true
      res.resume()
      resolve({ upgraded: false, status: res.statusCode })
    })
    request.on('error', (error) => {
      if (!settled) reject(error)
    })
    request.end()
  })
}
