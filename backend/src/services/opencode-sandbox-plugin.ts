import { ENV_NAME_PATTERN, SANDBOX_CONTROL_ENV_PREFIXES } from '@opencode-manager/shared/schemas'
import { sandboxPlanTimeoutMs, CHECKOUT_SANDBOX_NAME_PATTERN, SANDBOX_UNAVAILABLE_PREFIX } from './sandbox/command'
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
export const SANDBOX_NOTE_TIMEOUT_MS = 5000

export function buildSandboxPluginSource(id: string, shellShimPath: string, serviceSettingsPath: string): string {
  return `import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import os from 'os'
import path from 'path'

var SANDBOX_UNAVAILABLE_PREFIX = ${JSON.stringify(SANDBOX_UNAVAILABLE_PREFIX)}
var PLAN_TIMEOUT_MS = ${SANDBOX_PLAN_TIMEOUT_MS}
var NOTE_TIMEOUT_MS = ${SANDBOX_NOTE_TIMEOUT_MS}
var SHELL_SHIM_PATH = ${JSON.stringify(shellShimPath)}
var ENV_WORKDIR = ${JSON.stringify(SANDBOX_SHELL_ENV_WORKDIR)}
var ENV_SANDBOX_NAME = ${JSON.stringify(SANDBOX_SHELL_ENV_NAME)}
var ENV_FORWARD = ${JSON.stringify(SANDBOX_SHELL_ENV_FORWARD)}
var ENV_NAME_PATTERN = new RegExp(${JSON.stringify(ENV_NAME_PATTERN.source)})
var CONTROL_ENV_PREFIXES = ${JSON.stringify(SANDBOX_CONTROL_ENV_PREFIXES)}
var SERVICE_SETTINGS_PATH = path.resolve(${JSON.stringify(serviceSettingsPath)})
var SERVICE_SETTINGS_DIRECTORY = path.dirname(SERVICE_SETTINGS_PATH)
var SERVICE_SETTINGS_DENIED = 'OpenCode Manager denies access to its service settings file (service.json), which holds the OpenCode server password.'
var SANDBOX_NOTE_KEY = 'ocm-sandbox'
var SANDBOX_NOTE_PREFIX = '[Sandbox] '
var HOST_NOTE_MARKER = '[Sandbox] Execution has returned to the host environment'
var NETWORK_GROUP_LABELS = { public: 'public internet', private: 'LAN', host: 'the host' }
var SHELL_TOOL_NAME = 'shell'
var SHELL_MARKER_PREFIX = ${JSON.stringify(SANDBOX_SHELL_MARKER_PREFIX)}
var FORGE_MARKER_PATTERN = /forge-sandbox-required-[0-9a-f-]{36} && /
var FORGE_CONTAINER_ENV = 'FORGE_SANDBOX_CONTAINER'
var FORGE_CONFLICT = ${JSON.stringify("Forge's sandbox also claims this shell call. Turn off the sandbox for this session in OpenCode Manager, or set sandbox.enabled to false in ~/.config/opencode/forge-config.jsonc.")}
var SHELL_MARKER_PATTERN = /^(forge-sandbox-required-[0-9a-f-]{36} && )?(${SANDBOX_SHELL_MARKER_PREFIX}[0-9a-f-]{36}) && /
var PLAN_NAME_PATTERN = new RegExp(${JSON.stringify(CHECKOUT_SANDBOX_NAME_PATTERN.source)})
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

function hostEnvironmentLabel() {
  return os.type() + ' ' + os.release()
}

function formatResourceCount(cpus) {
  return cpus + (cpus === 1 ? ' CPU' : ' CPUs')
}

function formatGib(mib) {
  return String(Math.round((mib / 1024) * 10) / 10)
}

function describeResources(resources) {
  if (resources === null || typeof resources !== 'object') return null
  if (typeof resources.cpus !== 'number' || !Number.isFinite(resources.cpus)) return null
  if (typeof resources.memoryMib !== 'number' || !Number.isFinite(resources.memoryMib)) return null
  return formatResourceCount(resources.cpus) + ', ' + formatGib(resources.memoryMib) + ' GiB memory'
}

function describeNetwork(groups) {
  var labels = []
  if (Array.isArray(groups)) {
    for (var group of groups) {
      if (typeof group !== 'string') continue
      if (!Object.prototype.hasOwnProperty.call(NETWORK_GROUP_LABELS, group)) continue
      var label = NETWORK_GROUP_LABELS[group]
      if (labels.indexOf(label) !== -1) continue
      labels.push(label)
    }
  }
  if (labels.length === 0) return null
  if (labels.length === 1) return labels[0]
  return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1]
}

function sandboxNoteLines(environment) {
  var lines = []
  if (typeof environment.guest === 'string' && environment.guest.length > 0) {
    lines.push('Environment: microVM (' + environment.guest + ').')
  }
  var resources = environment.resources
  var current = null
  if (resources !== null && typeof resources === 'object') {
    current = resources.running !== null && typeof resources.running === 'object' ? resources.running : resources.effective
  }
  var resourceText = describeResources(current)
  if (resourceText !== null) lines.push('Resources: ' + resourceText + '.')
  var pending = environment.pendingResources
  var pendingText = pending !== null && typeof pending === 'object' ? describeResources(pending) : null
  if (pendingText !== null) lines.push('Pending after the VM restarts: ' + pendingText + '.')
  var allowed = describeNetwork(environment.network)
  lines.push(allowed === null ? 'Network: everything else blocked.' : 'Network: ' + allowed + '; everything else blocked.')
  lines.push('Shell commands run in the sandbox. Read, edit and write tools act on the same files on the host. The repository directory is shared with the host, so dependency directories or native build output from the other environment may target the wrong OS and must be reinstalled.')
  var idleMinutes = typeof environment.idleMinutes === 'number' && Number.isFinite(environment.idleMinutes) ? environment.idleMinutes : 0
  lines.push('The VM is shared with other sandboxed sessions in this repository checkout and is removed after ' + idleMinutes + ' minutes without commands, losing installed packages and Docker data.')
  lines.push('Passwordless sudo is available. Run \`ocm-dockerd-start\` once before your first Docker command. Playwright Chromium is under \`/ms-playwright\`.')
  return lines
}

function isHostNote(value) {
  return typeof value === 'string' && value.indexOf(HOST_NOTE_MARKER) === 0
}

function isSandboxNote(value) {
  return typeof value === 'string' && value.indexOf(SANDBOX_NOTE_PREFIX) === 0 && !isHostNote(value)
}

function isSwitchNote(value) {
  return typeof value === 'string' && value.indexOf(SANDBOX_NOTE_PREFIX + 'Environment changed') === 0
}

function prefixNoteLines(lines) {
  return lines.map(function (line) { return SANDBOX_NOTE_PREFIX + line }).join('\\n')
}

function buildSandboxNote(environment, previous) {
  var lines = sandboxNoteLines(environment)
  if (isHostNote(previous) || isSwitchNote(previous)) {
    var guest = typeof environment.guest === 'string' && environment.guest.length > 0 ? environment.guest : 'sandbox'
    lines.unshift('Environment changed: host (' + hostEnvironmentLabel() + ') -> microVM (' + guest + '). Reinstall dependencies built on the host.')
  }
  return prefixNoteLines(lines)
}

function buildHostNote() {
  return SANDBOX_NOTE_PREFIX + 'Execution has returned to the host environment (' + hostEnvironmentLabel() + '). Dependencies built inside the sandbox may target the wrong OS and must be reinstalled.'
}

async function fetchSandboxEnvironment(baseUrl, token, sessionID, directory) {
  var controller = new AbortController()
  var timer = setTimeout(function () { controller.abort() }, NOTE_TIMEOUT_MS)
  try {
    var res = await fetch(baseUrl + '/sandbox/sessions/' + encodeURIComponent(sessionID) + '/environment?directory=' + encodeURIComponent(directory), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    })
    if (!res.ok) return null
    var body = await res.json()
    if (body === null || typeof body !== 'object') return null
    if (typeof body.sandboxed !== 'boolean') return null
    return body
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function syncSandboxNote(ctx, sessionID) {
  try {
    var enforced = isEnforced()
    var baseUrl = process.env.OCM_INTERNAL_API_URL
    var token = process.env.OCM_INTERNAL_TOKEN
    if (enforced && (!baseUrl || !token)) return
    var entries = await ctx.session.instructions.entry.list({ sessionID: sessionID })
    var previous = null
    if (Array.isArray(entries)) {
      for (var entry of entries) {
        if (entry !== null && typeof entry === 'object' && entry.key === SANDBOX_NOTE_KEY) {
          previous = entry.value
          break
        }
      }
    }
    if (!enforced) {
      if (!isSandboxNote(previous)) return
      await ctx.session.instructions.entry.put({ sessionID: sessionID, key: SANDBOX_NOTE_KEY, value: buildHostNote() })
      return
    }
    var environment = await fetchSandboxEnvironment(baseUrl, token, sessionID, ctx.location.directory)
    if (environment === null) return
    var value = null
    if (environment.sandboxed !== true) {
      if (!isSandboxNote(previous)) return
      value = buildHostNote()
    } else {
      value = buildSandboxNote(environment, previous)
    }
    if (JSON.stringify(previous) === JSON.stringify(value)) return
    await ctx.session.instructions.entry.put({ sessionID: sessionID, key: SANDBOX_NOTE_KEY, value: value })
  } catch {
    return
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
    await ctx.session.hook('prompt', async (event) => {
      await syncSandboxNote(ctx, event.sessionID)
    })
    await ctx.session.hook('context', async (event) => {
      await syncSandboxNote(ctx, event.sessionID)
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
