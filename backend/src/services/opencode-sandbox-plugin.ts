import { sandboxPlanTimeoutMs, SANDBOX_UNAVAILABLE_PREFIX } from './sandbox/command'
import {
  SANDBOX_FORWARDED_ENV_NAMES,
  SANDBOX_SHELL_ENV_WORKDIR,
} from './sandbox/shell-shim'

export const SANDBOX_PLAN_TIMEOUT_MS = sandboxPlanTimeoutMs()

export function buildSandboxPluginSource(id: string, shellShimPath: string, serviceSettingsPath: string): string {
  return `import { existsSync } from 'fs'
import path from 'path'

var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${SANDBOX_PLAN_TIMEOUT_MS}
var SHELL_SHIM_PATH = ${JSON.stringify(shellShimPath)}
var ENV_WORKDIR = ${JSON.stringify(SANDBOX_SHELL_ENV_WORKDIR)}
var FORWARDED_ENV_NAMES = ${JSON.stringify(SANDBOX_FORWARDED_ENV_NAMES)}
var SERVICE_SETTINGS_PATH = path.resolve(${JSON.stringify(serviceSettingsPath)})
var SERVICE_SETTINGS_DIRECTORY = path.dirname(SERVICE_SETTINGS_PATH)
var SERVICE_SETTINGS_DENIED = 'OpenCode Manager denies access to its service settings file (service.json), which holds the OpenCode server password.'

function isEnforced() {
  return process.env.OCM_SANDBOX_ENFORCED === 'true'
}

function unavailable(reason) {
  return new Error(SANDBOX_UNAVAILABLE_PREFIX + reason)
}

function isWithin(directory, target) {
  var relative = path.relative(directory, target)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function globDirectory(resource) {
  var trimmed = resource
  while (trimmed.length > 0 && trimmed.charAt(trimmed.length - 1) === '*') {
    trimmed = trimmed.slice(0, -1)
  }
  while (trimmed.length > 1 && (trimmed.charAt(trimmed.length - 1) === '/' || trimmed.charAt(trimmed.length - 1) === path.sep)) {
    trimmed = trimmed.slice(0, -1)
  }
  return trimmed.length === 0 ? path.parse(SERVICE_SETTINGS_PATH).root : trimmed
}

function resourceResolvesToServiceSettings(resource) {
  return typeof resource === 'string' && resource.length > 0 && path.resolve(resource) === SERVICE_SETTINGS_PATH
}

function externalDirectoryTargetsServiceSettings(resource) {
  if (typeof resource !== 'string' || resource.length === 0) return false
  return isWithin(path.resolve(globDirectory(resource)), SERVICE_SETTINGS_DIRECTORY)
}

function absolutePathTargetsServiceSettings(value) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) return false
  var resolved = path.resolve(value)
  return resolved === SERVICE_SETTINGS_PATH || isWithin(resolved, SERVICE_SETTINGS_DIRECTORY)
}

function metadataTargetsServiceSettings(metadata) {
  if (metadata === null || typeof metadata !== 'object') return false
  return absolutePathTargetsServiceSettings(metadata.path)
    || (metadata.root !== metadata.path && absolutePathTargetsServiceSettings(metadata.root))
}

function deniesServiceSettings(event) {
  if (event.action === 'grep' || event.action === 'glob') {
    return metadataTargetsServiceSettings(event.metadata)
  }
  if (!Array.isArray(event.resources)) return false
  for (var index = 0; index < event.resources.length; index += 1) {
    var resource = event.resources[index]
    if (event.action === 'external_directory') {
      if (externalDirectoryTargetsServiceSettings(resource)) return true
    } else if (resourceResolvesToServiceSettings(resource)) {
      return true
    }
  }
  return false
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
  return plan
}

async function pinSandboxShell(event) {
  if (!existsSync(SHELL_SHIM_PATH)) {
    throw unavailable('the sandbox shell shim is missing at ' + SHELL_SHIM_PATH)
  }
  var plan = await planSandboxShell(event.cwd)
  if (plan.env !== null && typeof plan.env === 'object') {
    for (var name of FORWARDED_ENV_NAMES) {
      if (typeof plan.env[name] === 'string') {
        event.env[name] = plan.env[name]
      }
    }
  }
  if (!lockAccessor(event, 'shell', SHELL_SHIM_PATH)) {
    throw unavailable('sandbox enforcement could not pin the sandbox shell; aborting before the command runs on the host')
  }
  if (!lockAccessor(event.env, ENV_WORKDIR, plan.workdir)) {
    throw unavailable('sandbox enforcement could not pin the sandbox working directory; aborting before the command runs on the host')
  }
}

export default {
  id: '${id}',
  async setup(ctx) {
    await ctx.permission.hook('evaluate', (event) => {
      if (!isEnforced() || !deniesServiceSettings(event)) return
      event.effect = 'deny'
      event.message = SERVICE_SETTINGS_DENIED
    })
    await ctx.shell.hook('create.before', async (event) => {
      if (!isEnforced()) return
      await pinSandboxShell(event)
    })
    await ctx.tool.hook('execute.after', (event) => {
      if (!isEnforced() || event.tool !== 'shell' || event.status !== 'completed') return
      if (event.result === null || typeof event.result !== 'object') return
      event.result = { ...event.result, metadata: { ...(event.result.metadata ?? {}), sandbox: true } }
    })
  },
}
`
}
