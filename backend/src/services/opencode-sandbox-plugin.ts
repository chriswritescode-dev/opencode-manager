import { sandboxPlanTimeoutMs, SANDBOX_UNAVAILABLE_PREFIX } from './sandbox/command'
import { SANDBOX_SHELL_ENV_HOST_SHELL, SANDBOX_SHELL_ENV_WORKDIR } from './sandbox/shell-shim'

export const SANDBOX_PLAN_TIMEOUT_MS = sandboxPlanTimeoutMs()

export function buildSandboxPluginSource(shellShimPath: string): string {
  return `import { existsSync } from 'fs'

var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${SANDBOX_PLAN_TIMEOUT_MS}
var SHELL_SHIM_PATH = ${JSON.stringify(shellShimPath)}
var ENV_WORKDIR = ${JSON.stringify(SANDBOX_SHELL_ENV_WORKDIR)}
var ENV_HOST_SHELL = ${JSON.stringify(SANDBOX_SHELL_ENV_HOST_SHELL)}

function isEnforced() {
  return process.env.OCM_SANDBOX_ENFORCED === 'true'
}

function unavailable(reason) {
  return new Error(SANDBOX_UNAVAILABLE_PREFIX + reason)
}

function lockAccessor(target, key, value) {
  try {
    Object.defineProperty(target, key, {
      get: function () { return value },
      set: function () {},
      configurable: false,
      enumerable: true,
    })
  } catch (error) {
    return false
  }
  var descriptor = Object.getOwnPropertyDescriptor(target, key)
  return !!descriptor
    && descriptor.configurable === false
    && typeof descriptor.get === 'function'
    && target[key] === value
}

async function planSandboxShell(cwd) {
  var baseUrl = process.env.OCM_INTERNAL_API_URL
  var token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) {
    throw unavailable('sandbox plan lookup unavailable: internal API is not configured')
  }
  var controller = new AbortController()
  var planTimedOut = false
  var planTimer = setTimeout(function () {
    planTimedOut = true
    controller.abort()
  }, PLAN_TIMEOUT_MS)
  var plan = null
  var failure = null
  try {
    var res = await fetch(baseUrl + '/sandbox/shell', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ directory: cwd, enforced: true }),
      signal: controller.signal,
    })
    if (!res.ok) {
      failure = 'sandbox plan request failed with status ' + res.status
    } else {
      plan = await res.json()
    }
  } catch (error) {
    failure = planTimedOut ? 'sandbox plan lookup timed out' : (error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(planTimer)
  }
  if (failure !== null) {
    throw unavailable(failure)
  }
  if (plan === null || typeof plan !== 'object' || plan.mode !== 'sandbox' || typeof plan.workdir !== 'string' || plan.workdir.length === 0) {
    throw unavailable(plan !== null && typeof plan === 'object' && typeof plan.reason === 'string' ? plan.reason : 'sandbox plan request returned an invalid response')
  }
  return plan.workdir
}

export default async function () {
  var hostShell

  return {
    config: async (cfg) => {
      if (!isEnforced()) return
      var configured = cfg.shell
      if (typeof configured === 'string' && configured.length > 0 && configured !== SHELL_SHIM_PATH) {
        hostShell = configured
      }
      lockAccessor(cfg, 'shell', SHELL_SHIM_PATH)
    },
    'shell.env': async (input, output) => {
      if (!isEnforced() || typeof input.callID !== 'string' || input.callID.length === 0) {
        if (hostShell !== undefined) {
          output.env[ENV_HOST_SHELL] = hostShell
        }
        return
      }
      if (!existsSync(SHELL_SHIM_PATH)) {
        throw unavailable('the sandbox shell shim is missing at ' + SHELL_SHIM_PATH)
      }
      var workdir = await planSandboxShell(input.cwd)
      if (!lockAccessor(output.env, ENV_WORKDIR, workdir)) {
        throw unavailable('sandbox enforcement could not pin the sandbox working directory; aborting before the command runs on the host')
      }
    },
    'tool.execute.after': async (input, output) => {
      if (!isEnforced() || input.tool !== 'bash') return
      if (output.metadata === null || typeof output.metadata !== 'object') return
      output.metadata.sandbox = true
    },
  }
}
`
}
