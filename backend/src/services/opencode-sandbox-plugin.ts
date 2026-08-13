import path from 'path'
import { ENV } from '@opencode-manager/shared/config/env'
import { SANDBOX_UNAVAILABLE_PREFIX } from './sandbox/command'
import { writeFileAtomic } from '../utils/fs-safe'

const PLUGIN_FILENAME = 'ocm-sandbox.js'

const SANDBOX_PLAN_REQUEST_MARGIN_MS = 30000

export const SANDBOX_PLAN_TIMEOUT_MS = ENV.SANDBOX.START_TIMEOUT_MS + SANDBOX_PLAN_REQUEST_MARGIN_MS

const PLUGIN_SOURCE = `var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${SANDBOX_PLAN_TIMEOUT_MS}

function guardCommand(reason) {
  var safe = String(SANDBOX_UNAVAILABLE_PREFIX + reason).replace(/'/g, "'\\\\''")
  return "printf '%s\\\\n' '" + safe + "' >&2; exit 1"
}

function lockArgsReference(output, args) {
  try {
    Object.defineProperty(output, 'args', {
      get: function () { return args },
      set: function () {},
      configurable: false,
      enumerable: true,
    })
  } catch (error) {
    return false
  }
  var descriptor = Object.getOwnPropertyDescriptor(output, 'args')
  return !!descriptor && descriptor.configurable === false && typeof descriptor.get === 'function'
}

function lockCommand(args, command) {
  var current = null
  try {
    Object.defineProperty(args, 'command', {
      get: function () { return command },
      set: function () {},
      configurable: false,
      enumerable: true,
    })
    current = args.command
  } catch (error) {
    try {
      args.command = command
      current = args.command
    } catch (ignored) {
      current = null
    }
  }
  return current === command
}

var wrappedCommands = new Map()
var bypassed = false

function replaceCommand(output, command, callID) {
  if (!lockArgsReference(output, output.args)) {
    throw new Error('sandbox enforcement could not lock the bash arguments; aborting tool execution before it runs on the host')
  }
  if (!lockCommand(output.args, command)) {
    throw new Error('sandbox enforcement could not replace the bash command; aborting tool execution before it runs on the host')
  }
  wrappedCommands.set(callID, command)
}

export default async function ({ directory, worktree }) {
  return {
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash') return
      if (process.env.OCM_SANDBOX_ENFORCED !== 'true') return
      if (typeof output.args?.command !== 'string') {
        if (!lockArgsReference(output, output.args)) {
          throw new Error('sandbox enforcement could not lock the bash arguments; aborting tool execution before it runs on the host')
        }
        return
      }
      if (bypassed) {
        replaceCommand(output, guardCommand('sandbox enforcement was bypassed by another plugin; all sandboxed commands are now blocked'), input.callID)
        return
      }
      var baseUrl = process.env.OCM_INTERNAL_API_URL
      var token = process.env.OCM_INTERNAL_TOKEN
      if (!baseUrl || !token) {
        replaceCommand(output, guardCommand('sandbox plan lookup unavailable: internal API is not configured'), input.callID)
        return
      }
      var replacement = null
      var sessionDir = worktree || directory
      var effectiveDirectory = sessionDir
      var requestedWorkdir = output.args.workdir
      if (typeof requestedWorkdir === 'string' && requestedWorkdir.length > 0) {
        if (requestedWorkdir.charAt(0) === '/') {
          effectiveDirectory = requestedWorkdir
        } else {
          effectiveDirectory = sessionDir.replace(/\\/+$/, '') + '/' + requestedWorkdir
        }
      }
      var controller = new AbortController()
      var planTimedOut = false
      var planTimer = setTimeout(function () {
        planTimedOut = true
        controller.abort()
      }, PLAN_TIMEOUT_MS)
      try {
        var res = await fetch(baseUrl + '/sandbox/command', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({
            directory: effectiveDirectory,
            command: output.args.command,
            enforced: true,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          replacement = guardCommand('sandbox plan request failed with status ' + res.status)
        } else {
          var plan = await res.json()
          if (plan && typeof plan === 'object' && plan.mode === 'sandbox' && typeof plan.command === 'string' && plan.command.length > 0) {
            replacement = plan.command
          } else {
            replacement = guardCommand(plan && typeof plan === 'object' && typeof plan.reason === 'string' ? plan.reason : 'sandbox plan request returned an invalid response')
          }
        }
      } catch (error) {
        replacement = guardCommand(planTimedOut ? 'sandbox plan lookup timed out' : (error instanceof Error ? error.message : String(error)))
      } finally {
        clearTimeout(planTimer)
      }
      if (replacement !== null) {
        replaceCommand(output, replacement, input.callID)
      }
    },
    'tool.execute.after': async (input, output) => {
      if (input.tool !== 'bash') return
      if (process.env.OCM_SANDBOX_ENFORCED !== 'true') return
      var wrapped = wrappedCommands.get(input.callID)
      if (wrapped === undefined) return
      wrappedCommands.delete(input.callID)
      if (!bypassed && input.args && input.args.command !== wrapped) {
        bypassed = true
        console.error('OpenCode Manager: sandbox enforcement bypass detected for bash call ' + input.callID + '; blocking all further sandboxed commands')
      }
    },
  }
}
`

export function getSandboxPluginDir(configHome: string): string {
  return path.join(configHome, 'opencode', 'plugin')
}

export async function installSandboxPlugin(configHome: string): Promise<void> {
  await writeFileAtomic(path.join(getSandboxPluginDir(configHome), PLUGIN_FILENAME), PLUGIN_SOURCE)
}
