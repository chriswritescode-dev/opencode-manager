#!/usr/bin/env bun

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const OPENCODE_ATTACH_FUNCTION = `
# OpenCode attach function - connects to shared opencode server
opencode-attach() {
  local port=\${OPENCODE_PORT:-5551}
  local host=\${OPENCODE_HOST:-127.0.0.1}
  local server_url="http://\${host}:\${port}"
  
  # Check if server is running
  if ! curl -s --connect-timeout 1 "\${server_url}/health" > /dev/null 2>&1; then
    echo "Starting opencode server on port \${port}..."
    opencode serve --port "\${port}" --hostname "\${host}" &
    
    # Wait for server to be ready
    local retries=30
    while ! curl -s --connect-timeout 1 "\${server_url}/health" > /dev/null 2>&1; do
      retries=$((retries - 1))
      if [ \$retries -eq 0 ]; then
        echo "Error: Failed to start opencode server"
        return 1
      fi
      sleep 0.5
    done
    echo "Server started!"
  fi
  
  # Attach to server with current directory
  opencode attach "\${server_url}" --dir "\$(pwd)" "\$@"
}

# Alias for convenience
alias oc='opencode-attach'
alias occ='opencode-attach -c'
`

const MARKER_START = '# >>> opencode-attach >>>'
const MARKER_END = '# <<< opencode-attach <<<'

function getShellConfigPath(): string {
  const shell = process.env.SHELL || '/bin/bash'
  const home = os.homedir()
  
  if (shell.includes('zsh')) {
    return path.join(home, '.zshrc')
  } else if (shell.includes('bash')) {
    const bashrc = path.join(home, '.bashrc')
    const bashProfile = path.join(home, '.bash_profile')
    return fs.existsSync(bashrc) ? bashrc : bashProfile
  }
  
  return path.join(home, '.bashrc')
}

function install() {
  const configPath = getShellConfigPath()
  const configName = path.basename(configPath)
  
  console.log(`Installing opencode-attach to ${configPath}...`)
  
  let content = ''
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, 'utf-8')
  }
  
  const markerRegex = new RegExp(
    `${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`,
    'g'
  )
  content = content.replace(markerRegex, '')
  
  const block = `${MARKER_START}${OPENCODE_ATTACH_FUNCTION}${MARKER_END}\n`
  content = content.trimEnd() + '\n\n' + block
  
  fs.writeFileSync(configPath, content)
  
  console.log(`
✅ Installed opencode-attach to ${configName}

To use it, either:
  1. Restart your terminal, or
  2. Run: source ${configPath}

Usage:
  opencode-attach      # Start/attach in current directory
  opencode-attach -c   # Continue last session
  oc                   # Alias for opencode-attach
  occ                  # Alias for opencode-attach -c

Environment variables:
  OPENCODE_PORT=5551   # Server port (default: 5551)
  OPENCODE_HOST=127.0.0.1  # Server host (default: 127.0.0.1)
`)
}

function uninstall() {
  const configPath = getShellConfigPath()
  
  if (!fs.existsSync(configPath)) {
    console.log('No shell config found')
    return
  }
  
  let content = fs.readFileSync(configPath, 'utf-8')
  const markerRegex = new RegExp(
    `${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`,
    'g'
  )
  
  if (!markerRegex.test(content)) {
    console.log('opencode-attach not installed')
    return
  }
  
  content = content.replace(markerRegex, '')
  fs.writeFileSync(configPath, content.trimEnd() + '\n')
  
  console.log(`✅ Removed opencode-attach from ${configPath}`)
}

const command = process.argv[2]

if (command === 'uninstall') {
  uninstall()
} else {
  install()
}
