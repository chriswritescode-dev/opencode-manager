import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { z } from 'zod'

export interface RecordedUpstreamRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

export type UpstreamResponder = (
  request: RecordedUpstreamRequest,
  response: ServerResponse,
) => void | Promise<void>

export interface HttpUpstream {
  baseUrl: string
  port: number
  requests: RecordedUpstreamRequest[]
  setResponder: (responder: UpstreamResponder) => void
  close: () => Promise<void>
}

const BoundPortSchema = z.object({ port: z.number() })

function respondOk(_request: RecordedUpstreamRequest, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok')
}

export async function startHttpUpstream(responder: UpstreamResponder = respondOk): Promise<HttpUpstream> {
  let currentResponder = responder
  const requests: RecordedUpstreamRequest[] = []

  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const recorded: RecordedUpstreamRequest = {
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(recorded)
      void currentResponder(recorded, response)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = BoundPortSchema.parse(server.address()).port

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    setResponder: (next) => {
      currentResponder = next
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
