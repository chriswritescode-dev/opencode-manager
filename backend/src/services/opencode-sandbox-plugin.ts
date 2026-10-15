import { sandboxPlanTimeoutMs, SANDBOX_UNAVAILABLE_PREFIX } from './sandbox/command'
import {
  SANDBOX_FORWARDED_ENV_NAMES,
  SANDBOX_SHELL_ENV_FORWARD,
  SANDBOX_SHELL_ENV_NAME,
  SANDBOX_SHELL_ENV_WORKDIR,
} from './sandbox/shell-shim'

export const SANDBOX_PLAN_TIMEOUT_MS = sandboxPlanTimeoutMs()

export const SANDBOX_CLAIM_TIMEOUT_MS = 15000

export const SANDBOX_SHELL_STATE_KEY = 'ocm-sandbox.shell-state.v2'

const SANDBOX_DOCKER_HINT = '\n\nCommands run inside an isolated sandbox microVM that includes Docker (docker, docker compose, docker buildx). The Docker daemon is not started automatically: run `ocm-dockerd-start` once before your first docker command; it is safe to run again and exits immediately if the daemon is already running.'

export function buildSandboxPluginSource(id: string, shellShimPath: string, serviceSettingsPath: string): string {
  return `import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'

var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${SANDBOX_PLAN_TIMEOUT_MS}
var CLAIM_TIMEOUT_MS = ${SANDBOX_CLAIM_TIMEOUT_MS}
var SHELL_SHIM_PATH = ${JSON.stringify(shellShimPath)}
var ENV_WORKDIR = ${JSON.stringify(SANDBOX_SHELL_ENV_WORKDIR)}
var ENV_SANDBOX_NAME = ${JSON.stringify(SANDBOX_SHELL_ENV_NAME)}
var FORWARDED_ENV_NAMES = ${JSON.stringify(SANDBOX_FORWARDED_ENV_NAMES)}
var ENV_FORWARD = ${JSON.stringify(SANDBOX_SHELL_ENV_FORWARD)}
var SERVICE_SETTINGS_PATH = path.resolve(${JSON.stringify(serviceSettingsPath)})
var SERVICE_SETTINGS_DIRECTORY = path.dirname(SERVICE_SETTINGS_PATH)
var SERVICE_SETTINGS_DENIED = 'OpenCode Manager denies access to its service settings file (service.json), which holds the OpenCode server password.'
var DOCKER_HINT = ${JSON.stringify(SANDBOX_DOCKER_HINT)}
var SHELL_TOOL_NAME = 'shell'
var SHELL_MARKER_PREFIX = 'ocm-sandbox-required-'
var SHELL_MARKER_PATTERN = /^(ocm-sandbox-required-[0-9a-f-]{36}) && /
var PLAN_NAME_PATTERN = /^ocm-session-[0-9a-f]{12}$/
var ARBITER_KEY = Symbol.for('opencode.sandbox-arbiter.v1')
var SHELL_STATE_KEY = Symbol.for(${JSON.stringify(SANDBOX_SHELL_STATE_KEY)})
var OCM_PROVIDER_ID = 'ocm'
var TIER_RANK = { workload: 3, explicit: 2, default: 1 }

function shellSandboxState() {
  var state = globalThis[SHELL_STATE_KEY]
  if (state === undefined) {
    state = { pendingMarkers: new Map(), sandboxedCallIDs: new Set(), foreignOwners: new Map() }
    globalThis[SHELL_STATE_KEY] = state
  }
  return state
}

var shellState = shellSandboxState()

function sandboxArbiter() {
  var registry = globalThis[ARBITER_KEY]
  if (registry === undefined) {
    registry = { version: 1, providers: new Map(), decisions: new Map() }
    globalThis[ARBITER_KEY] = registry
    return registry
  }
  if (registry === null || typeof registry !== 'object' || registry.version !== 1 || !(registry.providers instanceof Map) || !(registry.decisions instanceof Map)) {
    throw unavailable('the sandbox arbiter registry at ' + String(ARBITER_KEY) + ' is invalid; refusing to run the command outside its sandbox')
  }
  return registry
}

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

async function resolveSessionClaim(sessionID) {
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
    || typeof body.sandboxed !== 'boolean'
    || (body.source !== 'default' && body.source !== 'user')
    || typeof body.since !== 'number'
    || !isFinite(body.since)) {
    throw unavailable('sandbox session lookup returned an invalid response')
  }
  if (!body.sandboxed) return null
  return { tier: body.source === 'user' ? 'explicit' : 'default', since: body.since }
}

function validClaim(claim) {
  return claim !== null && typeof claim === 'object'
    && (claim.tier === 'workload' || claim.tier === 'explicit' || claim.tier === 'default')
    && typeof claim.since === 'number'
    && isFinite(claim.since)
}

function raceClaim(provider, request) {
  return new Promise(function (resolve, reject) {
    var settled = false
    var timer = setTimeout(function () {
      settled = true
      reject(new Error('timed out after ' + CLAIM_TIMEOUT_MS + 'ms'))
    }, CLAIM_TIMEOUT_MS)
    function settle(fn) {
      return function (value) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
    }
    Promise.resolve()
      .then(function () { return provider.claim(request) })
      .then(settle(resolve), settle(reject))
  })
}

async function resolveSandboxOwner(request) {
  var arbiter = sandboxArbiter()
  var providers = Array.from(arbiter.providers.values())
  var claims = await Promise.all(providers.map(function (provider) {
    return raceClaim(provider, request).then(function (claim) {
      if (claim === null) return null
      if (!validClaim(claim)) {
        throw new Error('returned an invalid claim')
      }
      return { id: provider.id, tier: claim.tier, since: claim.since }
    }).catch(function (error) {
      var reason = error instanceof Error ? error.message : String(error)
      if (reason.indexOf(SANDBOX_UNAVAILABLE_PREFIX) === 0) reason = reason.slice(SANDBOX_UNAVAILABLE_PREFIX.length)
      throw unavailable('sandbox provider ' + provider.id + ' could not decide: ' + reason)
    })
  }))
  var ranked = claims.filter(function (claim) { return claim !== null })
  ranked.sort(function (a, b) {
    var byTier = TIER_RANK[b.tier] - TIER_RANK[a.tier]
    if (byTier !== 0) return byTier
    if (a.since !== b.since) return b.since - a.since
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
  return { owner: ranked.length > 0 ? ranked[0].id : null }
}

function noop() {}

function claimCallDecision(callID, request) {
  var arbiter = sandboxArbiter()
  if (arbiter.decisions.has(callID)) {
    return { decision: arbiter.decisions.get(callID), release: noop }
  }
  var decision = resolveSandboxOwner(request)
  decision.catch(function () {})
  arbiter.decisions.set(callID, decision)
  return {
    decision: decision,
    release: function () {
      if (arbiter.decisions.get(callID) === decision) arbiter.decisions.delete(callID)
    },
  }
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
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
      if (name.startsWith('OCM_') || name.startsWith('MSB_')) continue
      event.env[name] = value
      forwardNames.push(name)
    }
  }
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
        var claimed = claimCallDecision(context.id, { sessionID: context.sessionID, directory: ctx.location.directory })
        try {
          var owner = (await claimed.decision).owner
          if (owner !== OCM_PROVIDER_ID) {
            if (owner !== null) {
              shellState.foreignOwners.set(context.id, owner)
            }
            return await execute(input, context)
          }
          if (input === null || typeof input !== 'object' || typeof input.command !== 'string') {
            throw unavailable('refusing to run a sandboxed shell call without a command')
          }
          var marker = SHELL_MARKER_PREFIX + randomUUID()
          shellState.pendingMarkers.set(marker, { callID: context.id, sessionID: context.sessionID })
          shellState.sandboxedCallIDs.add(context.id)
          try {
            return await execute({ ...input, command: marker + ' && ' + input.command }, context)
          } finally {
            shellState.pendingMarkers.delete(marker)
          }
        } finally {
          claimed.release()
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
      var pending = shellState.pendingMarkers.get(marked[1])
      if (pending === undefined) {
        throw unavailable('sandbox marker ' + marked[1] + ' is not pending; refusing to run the command on the host')
      }
      shellState.pendingMarkers.delete(marked[1])
      event.command = event.command.slice(marked[0].length)
      await pinSandboxShell(event, pending.sessionID, ctx.location.directory)
    })
    await ctx.session.hook('context', async (event) => {
      if (!isEnforced()) return
      var shell = event.tools && event.tools.shell
      if (!shell) return
      if (typeof shell.description !== 'string' || shell.description.indexOf(DOCKER_HINT) !== -1) return
      var owner = null
      try {
        owner = (await resolveSandboxOwner({ sessionID: event.sessionID, directory: ctx.location.directory })).owner
      } catch (error) {
        return
      }
      if (owner !== OCM_PROVIDER_ID) return
      shell.description = shell.description + DOCKER_HINT
    })
    await ctx.tool.hook('execute.after', (event) => {
      if (!isEnforced() || event.tool !== SHELL_TOOL_NAME) return
      var owner = shellState.sandboxedCallIDs.has(event.id) ? OCM_PROVIDER_ID : shellState.foreignOwners.get(event.id)
      if (owner === undefined) return
      shellState.sandboxedCallIDs.delete(event.id)
      shellState.foreignOwners.delete(event.id)
      if (event.status !== 'completed') return
      if (event.result === null || typeof event.result !== 'object') return
      event.result = { ...event.result, metadata: { ...(event.result.metadata ?? {}), sandbox: true, sandboxProvider: owner } }
    })
    if (!isEnforced()) return
    var arbiter = sandboxArbiter()
    var provider = {
      id: OCM_PROVIDER_ID,
      claim: function (request) { return resolveSessionClaim(request.sessionID) },
    }
    arbiter.providers.set(OCM_PROVIDER_ID, provider)
    await wrapSandboxedShellTool(ctx)
    return function () {
      if (arbiter.providers.get(OCM_PROVIDER_ID) === provider) {
        arbiter.providers.delete(OCM_PROVIDER_ID)
      }
    }
  },
}
`
}
