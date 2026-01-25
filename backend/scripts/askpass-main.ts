#!/usr/bin/env bun
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

  const ipcHandlePath = process.env['VSCODE_GIT_IPC_HANDLE']

  const isSilent = !!process.env['VSCODE_GIT_FETCH_SILENT']
  console.error(`[askpass-main] pid=${process.pid}, output=${output}, askpassType=${askpassType}, ipcHandlePath=${ipcHandlePath}, silent=${isSilent}, argv=${argv.join(', ')}`)

  if (!ipcHandlePath) {
    console.error('[askpass-main] No IPC handle, returning empty')
    fs.writeFileSync(output, '\n')
    return process.exit(0)
  }

  const opts: http.RequestOptions = {
    socketPath: ipcHandlePath,
    path: '/askpass',
    method: 'POST'
  }

  console.error(`[askpass-main] Connecting to IPC server at ${ipcHandlePath}`)

  const req = http.request(opts, res => {
    console.error(`[askpass-main] IPC response status: ${res.statusCode}`)
    if (res.statusCode !== 200) {
      console.error('[askpass-main] IPC error response, returning empty')
      fs.writeFileSync(output, '\n')
      return process.exit(1)
    }

    const chunks: Buffer[] = []
    res.on('data', d => chunks.push(d))
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      console.error(`[askpass-main] IPC response body: "${body}"`)
      if (!body) {
        fs.writeFileSync(output, '\n')
        return process.exit(0)
      }
      try {
        const result = JSON.parse(body)
        console.error(`[askpass-main] Parsed result: "${result}"`)
        fs.writeFileSync(output, result + '\n')
        process.exit(0)
      } catch (e) {
        console.error('[askpass-main] JSON parse error:', e)
        fs.writeFileSync(output, '\n')
        process.exit(1)
      }
    })
  })

  req.on('error', (e) => {
    console.error('[askpass-main] IPC request error:', e.message)
    fs.writeFileSync(output, '\n')
    process.exit(1)
  })

  const requestPayload: AskpassRequest = { askpassType, argv }
  console.error('[askpass-main] Sending request:', JSON.stringify(requestPayload))
  req.write(JSON.stringify(requestPayload))
  req.end()
}

main(process.argv)
