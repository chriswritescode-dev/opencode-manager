import path from 'path'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { sandboxPlanTimeoutMs, SANDBOX_UNAVAILABLE_PREFIX } from './command'
import { writeFileAtomic } from '../../utils/fs-safe'

export const SANDBOX_SHELL_FILENAME = 'ocm-sandbox-shell'

const buildWrapperSource = (): string => `import { spawn } from 'child_process'

var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${sandboxPlanTimeoutMs()}

function failClosed(reason) {
  process.stderr.write(SANDBOX_UNAVAILABLE_PREFIX + reason + '\\n')
  process.exit(1)
}

function extractCommand(argv) {
  for (var index = 0; index < argv.length; index++) {
    if (argv[index] === '-c' && index + 1 < argv.length) {
      var command = argv[index + 1]
      if (typeof command === 'string' && command.length > 0) {
        return command
      }
      return null
    }
  }
  return null
}

async function main() {
  var command = extractCommand(process.argv.slice(2))
  if (command === null) {
    failClosed('interactive shell sessions are not available while sandbox enforcement is on')
    return
  }
  var cwd = process.cwd()
  var baseUrl = process.env.OCM_INTERNAL_API_URL
  var token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) {
    failClosed('internal API is not configured')
    return
  }
  var controller = new AbortController()
  var planTimedOut = false
  var planTimer = setTimeout(function () {
    planTimedOut = true
    controller.abort()
  }, PLAN_TIMEOUT_MS)
  try {
    var response = await fetch(baseUrl + '/sandbox/command', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ directory: cwd, command: command, enforced: true }),
      signal: controller.signal,
    })
    if (!response.ok) {
      failClosed('sandbox plan request failed with status ' + response.status)
      return
    }
    var plan = await response.json()
    if (plan && typeof plan === 'object' && plan.mode === 'sandbox' && typeof plan.command === 'string' && plan.command.length > 0) {
      var child = spawn('/bin/sh', ['-c', plan.command], { stdio: 'inherit' })
      child.on('exit', function (code, signal) {
        process.exit(code ?? (signal ? 1 : 0))
      })
      child.on('error', function (error) {
        failClosed(error instanceof Error ? error.message : String(error))
      })
    } else {
      var reason = plan && typeof plan === 'object' && typeof plan.reason === 'string' ? plan.reason : 'sandbox plan request returned an invalid response'
      failClosed(reason)
    }
  } catch (error) {
    failClosed(planTimedOut ? 'sandbox plan lookup timed out' : (error instanceof Error ? error.message : String(error)))
  } finally {
    clearTimeout(planTimer)
  }
}

main()
`

export function getSandboxShellDir(configHome: string): string {
  return path.join(configHome, 'ocm')
}

export function getSandboxShellPath(configHome: string): string {
  return path.join(getSandboxShellDir(configHome), SANDBOX_SHELL_FILENAME)
}

export function getEnforcedSandboxShellPath(): string {
  return getSandboxShellPath(path.join(getWorkspacePath(), '.config'))
}

export async function installSandboxShell(configHome: string): Promise<void> {
  const source = `#!${process.execPath}\n${buildWrapperSource()}`
  await writeFileAtomic(getSandboxShellPath(configHome), source, { mode: 0o700 })
}
