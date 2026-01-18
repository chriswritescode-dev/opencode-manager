import * as http from 'http'
import * as crypto from 'crypto'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'

function getIPCHandlePath(id: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\opencode-git-${id}-sock`
  }
  if (process.platform !== 'darwin' && process.env['XDG_RUNTIME_DIR']) {
    return path.join(process.env['XDG_RUNTIME_DIR'], `opencode-git-${id}.sock`)
  }
  return path.join(os.tmpdir(), `opencode-git-${id}.sock`)
}

export interface IPCHandler {
  handle(request: unknown): Promise<unknown>
}

export class IPCServer {
  private handlers = new Map<string, IPCHandler>()

  constructor(
    private server: http.Server,
    public readonly ipcHandlePath: string
  ) {
    server.on('request', (req, res) => this.onRequest(req, res))
  }

  registerHandler(name: string, handler: IPCHandler): void {
    this.handlers.set(`/${name}`, handler)
  }

  getEnv(): Record<string, string> {
    return { VSCODE_GIT_IPC_HANDLE: this.ipcHandlePath }
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const handler = this.handlers.get(req.url || '')
    if (!handler) {
      res.writeHead(404)
      res.end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (d: Buffer) => chunks.push(d))
    req.on('end', async () => {
      try {
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const result = await handler.handle(request)
        res.writeHead(200)
        res.end(JSON.stringify(result))
      } catch {
        res.writeHead(500)
        res.end()
      }
    })
  }

  dispose(): void {
    this.server.close()
  }
}

export async function createIPCServer(context?: string): Promise<IPCServer> {
  const server = http.createServer()
  const hash = crypto.createHash('sha256')

  if (!context) {
    const buffer = crypto.randomBytes(20)
    hash.update(buffer)
  } else {
    hash.update(context)
  }

  const ipcHandlePath = getIPCHandlePath(hash.digest('hex').substring(0, 10))

  if (process.platform !== 'win32') {
    try {
      await fs.unlink(ipcHandlePath)
    } catch {
      /* socket file may not exist */
    }
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(ipcHandlePath, () => {
      resolve(new IPCServer(server, ipcHandlePath))
    })
  })
}
