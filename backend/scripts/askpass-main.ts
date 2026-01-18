import http from 'http'
import fs from 'fs'

interface AskpassRequest {
  askpassType: 'https' | 'ssh'
  argv: string[]
}

function fatal(err: unknown): never {
  if (err instanceof Error) {
    console.error(err.message)
  } else if (typeof err === 'string') {
    console.error(err)
  }
  process.exit(1)
}

function main(argv: string[]): void {
  const output = process.env['VSCODE_GIT_ASKPASS_PIPE']
  if (!output) {
    return fatal('Missing pipe')
  }

  const askpassType = process.env['VSCODE_GIT_ASKPASS_TYPE']
  if (!askpassType) {
    return fatal('Missing type')
  }

  if (askpassType !== 'https' && askpassType !== 'ssh') {
    return fatal(`Invalid type: ${askpassType}`)
  }

  if (process.env['VSCODE_GIT_FETCH_SILENT']) {
    fs.writeFileSync(output, '\n')
    return process.exit(0)
  }

  const ipcHandlePath = process.env['VSCODE_GIT_IPC_HANDLE']

  if (!ipcHandlePath) {
    fs.writeFileSync(output, '\n')
    return process.exit(0)
  }

  const opts: http.RequestOptions = {
    socketPath: ipcHandlePath,
    path: '/askpass',
    method: 'POST'
  }

  const req = http.request(opts, res => {
    if (res.statusCode !== 200) {
      fs.writeFileSync(output, '\n')
      return process.exit(1)
    }

    const chunks: Buffer[] = []
    res.on('data', d => chunks.push(d))
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      if (!body) {
        fs.writeFileSync(output, '\n')
        return process.exit(0)
      }
      try {
        const result = JSON.parse(body)
        fs.writeFileSync(output, result + '\n')
        process.exit(0)
      } catch {
        fs.writeFileSync(output, '\n')
        process.exit(1)
      }
    })
  })

  req.on('error', () => {
    fs.writeFileSync(output, '\n')
    process.exit(1)
  })

  const requestPayload: AskpassRequest = { askpassType, argv }
  req.write(JSON.stringify(requestPayload))
  req.end()
}

main(process.argv)
