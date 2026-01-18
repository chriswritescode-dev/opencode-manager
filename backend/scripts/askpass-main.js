const http = require('http')
const fs = require('fs')

function fatal(err) {
  process.exit(1)
}

function main(argv) {
  if (!process.env['VSCODE_GIT_ASKPASS_PIPE']) {
    return fatal('Missing pipe')
  }
  if (!process.env['VSCODE_GIT_ASKPASS_TYPE']) {
    return fatal('Missing type')
  }
  if (process.env['VSCODE_GIT_COMMAND'] === 'fetch' && process.env['VSCODE_GIT_FETCH_SILENT']) {
    return fatal('Skip silent fetch commands')
  }

  const output = process.env['VSCODE_GIT_ASKPASS_PIPE']
  const askpassType = process.env['VSCODE_GIT_ASKPASS_TYPE']
  const ipcHandlePath = process.env['VSCODE_GIT_IPC_HANDLE']

  if (!ipcHandlePath) {
    fs.writeFileSync(output, '\n')
    return process.exit(0)
  }

  const opts = {
    socketPath: ipcHandlePath,
    path: '/askpass',
    method: 'POST'
  }

  const req = http.request(opts, res => {
    if (res.statusCode !== 200) {
      fs.writeFileSync(output, '\n')
      return process.exit(1)
    }

    const chunks = []
    res.on('data', d => chunks.push(d))
    res.on('end', () => {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      fs.writeFileSync(output, result + '\n')
      process.exit(0)
    })
  })

  req.on('error', () => {
    fs.writeFileSync(output, '\n')
    process.exit(1)
  })

  req.write(JSON.stringify({ askpassType, argv }))
  req.end()
}

main(process.argv)
