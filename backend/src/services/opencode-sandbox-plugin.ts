import { ENV_NAME_PATTERN, SANDBOX_CONTROL_ENV_PREFIXES } from '@opencode-manager/shared/schemas'
import { sandboxPlanTimeoutMs, SANDBOX_UNAVAILABLE_PREFIX } from './sandbox/command'
import {
  SANDBOX_SHELL_ENV_FORWARD,
  SANDBOX_SHELL_ENV_NAME,
  SANDBOX_SHELL_ENV_WORKDIR,
} from './sandbox/shell-shim'
import {
  SANDBOX_SHELL_MARKER_PREFIX,
  SANDBOX_SHELL_STATE_KEY,
  SECRET_MASK_STORE_SOURCE,
} from './opencode-plugin-state'

export const SANDBOX_PLAN_TIMEOUT_MS = sandboxPlanTimeoutMs()

const SANDBOX_DOCKER_HINT = '\n\nCommands run inside an isolated sandbox microVM that includes Docker (docker, docker compose, docker buildx). The Docker daemon is not started automatically: run `ocm-dockerd-start` once before your first docker command; it is safe to run again and exits immediately if the daemon is already running.'

export function buildSandboxPluginSource(id: string, shellShimPath: string, serviceSettingsPath: string): string {
  return `import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'

var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${SANDBOX_PLAN_TIMEOUT_MS}
var SHELL_SHIM_PATH = ${JSON.stringify(shellShimPath)}
var ENV_WORKDIR = ${JSON.stringify(SANDBOX_SHELL_ENV_WORKDIR)}
var ENV_SANDBOX_NAME = ${JSON.stringify(SANDBOX_SHELL_ENV_NAME)}
var ENV_FORWARD = ${JSON.stringify(SANDBOX_SHELL_ENV_FORWARD)}
var ENV_NAME_PATTERN = new RegExp(${JSON.stringify(ENV_NAME_PATTERN.source)})
var CONTROL_ENV_PREFIXES = ${JSON.stringify(SANDBOX_CONTROL_ENV_PREFIXES)}
var SERVICE_SETTINGS_PATH = path.resolve(${JSON.stringify(serviceSettingsPath)})
var SERVICE_SETTINGS_DIRECTORY = path.dirname(SERVICE_SETTINGS_PATH)
var SERVICE_SETTINGS_DENIED = 'OpenCode Manager denies access to its service settings file (service.json), which holds the OpenCode server password.'
var DOCKER_HINT = ${JSON.stringify(SANDBOX_DOCKER_HINT)}
var SHELL_TOOL_NAME = 'shell'
var SHELL_MARKER_PREFIX = ${JSON.stringify(SANDBOX_SHELL_MARKER_PREFIX)}
var FORGE_MARKER_PATTERN = /forge-sandbox-required-[0-9a-f-]{36} && /
var FORGE_CONTAINER_ENV = 'FORGE_SANDBOX_CONTAINER'
var FORGE_CONFLICT = ${JSON.stringify("Forge's sandbox also claims this shell call. Turn off the sandbox for this session in OpenCode Manager, or set sandbox.enabled to false in ~/.config/opencode/forge-config.jsonc.")}
var SHELL_MARKER_PATTERN = /^(forge-sandbox-required-[0-9a-f-]{36} && )?(${SANDBOX_SHELL_MARKER_PREFIX}[0-9a-f-]{36}) && /
var PLAN_NAME_PATTERN = /^ocm-session-[0-9a-f]{12}$/
var SHELL_STATE_KEY = Symbol.for(${JSON.stringify(SANDBOX_SHELL_STATE_KEY)})

${SECRET_MASK_STORE_SOURCE}

function isControlEnvName(name) {
  return CONTROL_ENV_PREFIXES.some(function (prefix) { return name.indexOf(prefix) === 0 })
}

function shellSandboxState() {
  var state = globalThis[SHELL_STATE_KEY]
  if (state === undefined) {
    state = { pendingMarkers: new Map(), sandboxedCallIDs: new Set(), inFlightSandboxedCommands: new Map() }
    globalThis[SHELL_STATE_KEY] = state
  }
  return state
}

function pinInFlightSandboxCommand(command, markedCommand) {
  var inFlight = shellState.inFlightSandboxedCommands
  inFlight.set(command, (inFlight.get(command) || 0) + 1)
  inFlight.set(markedCommand, (inFlight.get(markedCommand) || 0) + 1)
}

function releaseInFlightSandboxCommand(command, markedCommand) {
  var inFlight = shellState.inFlightSandboxedCommands
  for (var key of [command, markedCommand]) {
    var count = inFlight.get(key) || 0
    if (count <= 1) inFlight.delete(key)
    else inFlight.set(key, count - 1)
  }
}

var shellState = shellSandboxState()

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

function isForgeShellPath(shell) {
  return path.basename(shell).indexOf('forge-shell') === 0
}

function forgeClaims(command, env, shell) {
  if (typeof command === 'string' && FORGE_MARKER_PATTERN.test(command)) return true
  if (env !== null && typeof env === 'object') {
    var container = env[FORGE_CONTAINER_ENV]
    if (typeof container === 'string' && container.length > 0) return true
  }
  return typeof shell === 'string' && isForgeShellPath(shell)
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
      set: function () {
        throw unavailable('another plugin tried to replace a shell setting pinned by OpenCode Manager; aborting before the command runs outside its sandbox')
      },
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

async function isSessionSandboxed(sessionID) {
  var baseUrl = process.env.OCM_INTERNAL_API_URL
  var token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) {
    throw unavailable('sandbox session lookup unavailable: internal API is not configured')
  }
  var controller = new AbortController()
  var lookupTimedOut = false
  var lookupTimer = setTimeout(function () {
    lookupTimedOut = true
    controller.abort()
  }, PLAN_TIMEOUT_MS)
  var body = null
  var failure = null
  try {
    var res = await fetch(baseUrl + '/sandbox/sessions/' + encodeURIComponent(sessionID), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    })
    if (!res.ok) {
      failure = 'sandbox session lookup failed with status ' + res.status
    } else {
      body = await res.json()
    }
  } catch (error) {
    failure = lookupTimedOut ? 'sandbox session lookup timed out' : (error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(lookupTimer)
  }
  if (failure !== null) {
    throw unavailable(failure)
  }
  if (body === null || typeof body !== 'object'
    || typeof body.sandboxed !== 'boolean') {
    throw unavailable('sandbox session lookup returned an invalid response')
  }
  return body.sandboxed
}

async function planSandboxShell(cwd, sessionID, locationDirectory) {
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
      body: JSON.stringify({ directory: cwd, sessionId: sessionID, locationDirectory: locationDirectory, enforced: true }),
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
  if (plan === null || typeof plan !== 'object'
    || plan.mode !== 'sandbox'
    || typeof plan.workdir !== 'string' || plan.workdir.length === 0
    || typeof plan.name !== 'string' || !PLAN_NAME_PATTERN.test(plan.name)) {
    throw unavailable(plan !== null && typeof plan === 'object' && typeof plan.reason === 'string' ? plan.reason : 'sandbox plan request returned an invalid response')
  }
  return plan
}

async function pinSandboxShell(event, sessionID, locationDirectory) {
  if (!existsSync(SHELL_SHIM_PATH)) {
    throw unavailable('the sandbox shell shim is missing at ' + SHELL_SHIM_PATH)
  }
  var plan = await planSandboxShell(event.cwd, sessionID, locationDirectory)
  var forwardNames = []
  if (plan.env !== null && typeof plan.env === 'object') {
    for (var name of Object.keys(plan.env)) {
      var value = plan.env[name]
      if (typeof value !== 'string') continue
      if (!ENV_NAME_PATTERN.test(name)) continue
      if (isControlEnvName(name)) continue
      event.env[name] = value
      forwardNames.push(name)
    }
  }
  replaceMaskValues(event.cwd, plan.mask)
  if (!lockAccessor(event, 'shell', SHELL_SHIM_PATH)) {
    throw unavailable('sandbox enforcement could not pin the sandbox shell; aborting before the command runs on the host')
  }
  if (!lockAccessor(event.env, ENV_WORKDIR, plan.workdir)) {
    throw unavailable('sandbox enforcement could not pin the sandbox working directory; aborting before the command runs on the host')
  }
  if (!lockAccessor(event.env, ENV_SANDBOX_NAME, plan.name)) {
    throw unavailable('sandbox enforcement could not pin the sandbox session name; aborting before the command runs on the host')
  }
  if (!lockAccessor(event.env, ENV_FORWARD, forwardNames.join(' '))) {
    throw unavailable('sandbox enforcement could not pin the forwarded environment list; aborting before the command runs on the host')
  }
}

async function wrapSandboxedShellTool(ctx) {
  await ctx.tool.transform(function (editor) {
    editor.update(SHELL_TOOL_NAME, function (tool) {
      var execute = tool.execute
      tool.execute = async function (input, context) {
        var sandboxed = await isSessionSandboxed(context.sessionID)
        if (!sandboxed) return await execute(input, context)
        if (input === null || typeof input !== 'object' || typeof input.command !== 'string') {
          throw unavailable('refusing to run a sandboxed shell call without a command')
        }
        if (forgeClaims(input.command)) {
          throw unavailable(FORGE_CONFLICT)
        }
        var marker = SHELL_MARKER_PREFIX + randomUUID()
        var markedCommand = marker + ' && ' + input.command
        shellState.pendingMarkers.set(marker, { callID: context.id, sessionID: context.sessionID })
        shellState.sandboxedCallIDs.add(context.id)
        pinInFlightSandboxCommand(input.command, markedCommand)
        try {
          return await execute({ ...input, command: markedCommand }, context)
        } finally {
          releaseInFlightSandboxCommand(input.command, markedCommand)
          shellState.pendingMarkers.delete(marker)
        }
      }
    })
  })
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
      var marked = SHELL_MARKER_PATTERN.exec(event.command)
      if (marked === null) return
      var pending = shellState.pendingMarkers.get(marked[2])
      if (pending === undefined) {
        throw unavailable('sandbox marker ' + marked[2] + ' is not pending; refusing to run the command on the host')
      }
      shellState.pendingMarkers.delete(marked[2])
      var unmarked = (marked[1] === undefined ? '' : marked[1]) + event.command.slice(marked[0].length)
      if (forgeClaims(unmarked, event.env, event.shell)) {
        throw unavailable(FORGE_CONFLICT)
      }
      event.command = event.command.slice(marked[0].length)
      await pinSandboxShell(event, pending.sessionID, ctx.location.directory)
    })
    await ctx.session.hook('context', async (event) => {
      if (!isEnforced()) return
      var shell = event.tools && event.tools.shell
      if (!shell) return
      if (typeof shell.description !== 'string' || shell.description.indexOf(DOCKER_HINT) !== -1) return
      var sandboxed = false
      try {
        sandboxed = await isSessionSandboxed(event.sessionID)
      } catch (error) {
        return
      }
      if (!sandboxed) return
      shell.description = shell.description + DOCKER_HINT
    })
    await ctx.tool.hook('execute.after', (event) => {
      if (!isEnforced() || event.tool !== SHELL_TOOL_NAME) return
      if (!shellState.sandboxedCallIDs.has(event.id)) return
      shellState.sandboxedCallIDs.delete(event.id)
      if (event.status !== 'completed') return
      if (event.result === null || typeof event.result !== 'object') return
      event.result = { ...event.result, metadata: { ...(event.result.metadata ?? {}), sandbox: true } }
    })
    if (!isEnforced()) return
    await wrapSandboxedShellTool(ctx)
  },
}
`
}
