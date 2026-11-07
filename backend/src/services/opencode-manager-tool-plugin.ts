import { z } from 'zod'
import {
  ASSISTANT_NOTIFICATION_LIMITS,
  BUILTIN_OUTPUT_DEFINITIONS,
  DefineOutputParamsSchema,
  MANAGER_PROMPT_CLIENT_METADATA_KEY,
  MANAGER_PROMPT_CLIENTS,
  MANAGER_TOOL_ACTIONS,
  MANAGER_TOOL_NAME,
  OpenOutputParamsSchema,
  OutputDefinitionIdSchema,
  OutputParamsSchema,
  ReadOutputInputParamsSchema,
  ShowArtifactParamsSchema,
} from '@opencode-manager/shared/schemas'

const MANAGER_TOOL_REQUEST_TIMEOUT_MS = 60000

const MOBILE_PROMPT_CLIENT = MANAGER_PROMPT_CLIENTS[0]

const DESKTOP_PROMPT_CLIENT = MANAGER_PROMPT_CLIENTS[1]

export const MANAGER_MOBILE_OUTPUT_INSTRUCTIONS =
  'The user is on a mobile device and may listen to your replies with text-to-speech. Write replies as short, plain, conversational sentences that read well aloud. Avoid tables, headings, code blocks, long or nested lists, file paths, URLs, and raw symbols unless the user explicitly asks for them; describe technical details in words instead. Lead with the outcome and keep it brief. This only changes how you write replies, not how thoroughly you work or use tools.'

export const MANAGER_TOOL_ALLOWED_ROUTES = [
  'GET /settings',
  'PATCH /settings',
  'GET /opencode-config',
  'GET /opencode-config/effective',
  'GET /opencode-config/mcp',
  'PATCH /opencode-config',
  'POST /assistant/reload',
  'GET /repos',
  'POST /repos',
  'GET /repos/*/git-info',
  'GET /opencode-workspaces',
  'GET /sessions',
  'POST /sessions',
  'POST /sessions/*/prompt',
  'GET /sessions/*/reply',
  'POST /sessions/*/fork',
  'GET /schedules/all',
  'GET /schedules/all/runs',
  'GET /repos/*/schedules',
  'POST /repos/*/schedules',
  'GET /repos/*/schedules/*',
  'PATCH /repos/*/schedules/*',
  'DELETE /repos/*/schedules/*',
  'GET /repos/*/schedules/*/worktrees',
  'POST /repos/*/schedules/*/run',
  'GET /repos/*/schedules/*/runs',
  'DELETE /repos/*/schedules/*/runs',
  'GET /repos/*/schedules/*/runs/*',
  'DELETE /repos/*/schedules/*/runs/*',
  'POST /repos/*/schedules/*/runs/*/cancel',
] as const

const MANAGER_TOOL_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const ManagerToolNotificationParamsSchema = z
  .object({
    title: z.string().min(1).max(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX).describe('The notification title.'),
    body: z.string().min(1).max(ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX).describe('The notification body.'),
    url: z.string().min(1).max(ASSISTANT_NOTIFICATION_LIMITS.URL_MAX).optional().describe('A deep link to open, such as /repos/my-repo.'),
    tag: z.string().max(ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX).optional().describe('A deduplication key for replacing an earlier notification.'),
    priority: z.enum(['normal', 'high']).optional().describe('Use high for something that should interrupt the user.'),
  })
  .strict()
  .describe('Send a push notification to every device the user has registered.')

const ManagerToolRequestParamsSchema = z
  .object({
    method: z.enum(MANAGER_TOOL_ALLOWED_METHODS).describe('The HTTP method for the internal API route.'),
    path: z.string().min(1).max(500).describe('The internal API route path, such as /settings or /repos/0/schedules. Query strings are allowed.'),
    body: z.record(z.string(), z.unknown()).optional().describe('The JSON request body, for POST and PATCH routes.'),
  })
  .strict()
  .describe('Call an allow-listed OpenCode Manager internal API route.')

const ManagerToolOpenOutputParamsSchema = OpenOutputParamsSchema.extend({
  definitionId: OutputDefinitionIdSchema.describe(
    'Output definition id, for example "walkthrough" for the built-in change walkthrough.',
  ),
}).describe('Open the output for an output definition in this session.')

const ManagerToolDefineOutputParamsSchema = DefineOutputParamsSchema.describe('Define an output for this session only.')

const ManagerToolReadOutputInputParamsSchema = ReadOutputInputParamsSchema.describe(
  "Read the changes this output was generated from. Omit params.file for an outline of every changed file; pass params.file for one file's full hunks.",
)

const ManagerToolPublishOutputParamsSchema = z
  .object({
    definitionId: OutputDefinitionIdSchema.optional().describe('The output definition id when publishing a current-session definition.'),
    params: OutputParamsSchema.optional().describe('The output parameters when publishing a current-session definition.'),
    data: z.unknown().optional().describe('The output data, matching the definition data schema.'),
    path: z.string().trim().min(1).max(1000).optional().describe('Path of the HTML file for an html output.'),
  })
  .strict()
  .refine((value) => (value.data !== undefined) !== (value.path !== undefined), { message: 'Provide exactly one of data or path' })
  .describe('Publish the output you built so the Manager Outputs panel renders it.')

const MANAGER_TOOL_ACTION_PARAMS_SCHEMAS: Record<(typeof MANAGER_TOOL_ACTIONS)[number], z.ZodType> = {
  send_notification: ManagerToolNotificationParamsSchema,
  request: ManagerToolRequestParamsSchema,
  open_output: ManagerToolOpenOutputParamsSchema,
  show_artifact: ShowArtifactParamsSchema.describe('Show a self-contained HTML file the agent wrote to the user, rendered inline in the Manager chat in a sandboxed frame.'),
  define_output: ManagerToolDefineOutputParamsSchema,
  read_output_input: ManagerToolReadOutputInputParamsSchema,
  publish_output: ManagerToolPublishOutputParamsSchema,
}

export function parseAllowedRoute(route: string): { method: string; path: string } {
  const separator = route.indexOf(' ')
  return { method: route.slice(0, separator), path: route.slice(separator + 1) }
}

function buildRouteMatchers(): { method: string; source: string }[] {
  return MANAGER_TOOL_ALLOWED_ROUTES.map((route) => {
    const { method, path } = parseAllowedRoute(route)
    const source = path
      .split('/')
      .map((segment) => (segment === '*' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    return { method, source: `^${source}$` }
  })
}

function requiredKeysOf(schema: z.ZodType): string[] {
  const jsonSchema = z.toJSONSchema(schema) as { required?: string[] }
  return jsonSchema.required ?? []
}

function buildManagerToolInputJsonSchema(): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(
    z
      .object({
        action: z.enum(MANAGER_TOOL_ACTIONS).describe('The OpenCode Manager action to perform.'),
        params: z
          .union([
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.send_notification,
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.request,
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.open_output,
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.show_artifact,
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.define_output,
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.read_output_input,
            MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.publish_output,
          ])
          .describe('The parameters for the chosen action.'),
      })
      .strict(),
  )
  delete jsonSchema.$schema
  return jsonSchema
}

function buildManagerToolActionRequiredKeys(): Record<string, string[]> {
  return Object.fromEntries(MANAGER_TOOL_ACTIONS.map((name) => [name, requiredKeysOf(MANAGER_TOOL_ACTION_PARAMS_SCHEMAS[name])]))
}

function buildManagerToolDescription(): string {
  const builtinOutputs = BUILTIN_OUTPUT_DEFINITIONS.map(
    (definition) => `${definition.id} (${definition.description})`,
  ).join('; ')
  return [
    'Perform an OpenCode Manager action.',
    'The action runs inside OpenCode Manager itself, so it needs no token and no network access from the agent shell, and it works in sandboxed sessions and scheduled runs.',
    'Actions:',
    '- send_notification: send a push notification to every device the user has registered.',
    '- request: call an allow-listed internal API route to read and manage settings, the OpenCode configuration file, repos (list, inspect, clone from a git URL with POST /repos and body { repoUrl, branch?, directoryName? }), OpenCode workspaces, sessions (list, create, follow up, read the latest reply, fork), and schedules.',
    `- open_output: open an output for this session. Built-in definitions: ${builtinOutputs} Use definitionId "walkthrough" when the user asks to walk through, review or explain the changes; its optional params.source takes a change source and defaults to this session's changes. Use the id the user names for a global output or one defined with define_output. A separate-session definition starts its output session and waits until it is ready (this can take several minutes), then it opens in the Manager Outputs panel when this session is open on desktop; otherwise the user opens it from this tool call. A current-session definition returns its instructions and data schema so you build and publish it with publish_output.`,
    '- define_output: define an output for this session only. Pass { definition } with id, label, description, icon, params, provider?, instructions, dataSchema?, renderer and generation.',
    "- read_output_input: only valid inside a generated output session. Call it with no arguments for an outline of the changed files, or with { file } for one file's full hunks.",
    '- publish_output: only valid inside a generated output session or for a current-session definition. Pass { data } matching the definition data schema, or { path } for an HTML output.',
    '- show_artifact: write a self-contained .html file with your file tools, then call show_artifact with its path to show it to the user, rendered inline in this session\'s Manager chat inside a sandboxed frame. Edit the file to fix or change it (no need to resend content). Inline your own CSS and JavaScript; libraries may load from public CDNs. Forms, popups, cookies and local storage are blocked. Single file only: sibling .js and .css files will not load.',
    'Allowed request routes:',
  ]
    .concat(MANAGER_TOOL_ALLOWED_ROUTES.map((route) => `- ${route}`))
    .join('\n')
}

/** Builds the standalone manager plugin with API actions and mobile session hooks. */
export function buildManagerToolPluginSource(id: string): string {
  return `var REQUEST_TIMEOUT_MS = ${MANAGER_TOOL_REQUEST_TIMEOUT_MS}

var OUTPUT_POLL_INTERVAL_MS = 2000

var ALLOWED_ROUTES = ${JSON.stringify(MANAGER_TOOL_ALLOWED_ROUTES)}

var ALLOWED_MATCHERS = ${JSON.stringify(buildRouteMatchers())}.map(function (matcher) {
  return { method: matcher.method, pattern: new RegExp(matcher.source) }
})

var ACTION_NAMES = ${JSON.stringify(MANAGER_TOOL_ACTIONS)}

var ACTION_REQUIRED_KEYS = ${JSON.stringify(buildManagerToolActionRequiredKeys())}

var INPUT_SCHEMA = ${JSON.stringify(buildManagerToolInputJsonSchema(), null, 2)}

var DESCRIPTION = ${JSON.stringify(buildManagerToolDescription())}

var CLIENT_METADATA_KEY = ${JSON.stringify(MANAGER_PROMPT_CLIENT_METADATA_KEY)}

var MOBILE_CLIENT = ${JSON.stringify(MOBILE_PROMPT_CLIENT)}

var DESKTOP_CLIENT = ${JSON.stringify(DESKTOP_PROMPT_CLIENT)}

var MOBILE_OUTPUT_INSTRUCTIONS = ${JSON.stringify(MANAGER_MOBILE_OUTPUT_INSTRUCTIONS)}

var MOBILE_SESSIONS = new Set()

/** Updates mobile mode from explicit client metadata, preserving it when metadata is absent. */
function trackMobileSession(event) {
  var client = event.metadata && event.metadata[CLIENT_METADATA_KEY]
  if (client === MOBILE_CLIENT) {
    MOBILE_SESSIONS.add(event.sessionID)
  } else if (client === DESKTOP_CLIENT) {
    MOBILE_SESSIONS.delete(event.sessionID)
  }
}

/** Appends mobile reply guidance to the context of a tracked mobile session. */
function addMobileOutputInstructions(event) {
  if (MOBILE_SESSIONS.has(event.sessionID)) {
    event.system.push({ type: 'text', text: MOBILE_OUTPUT_INSTRUCTIONS })
  }
}

function resolveRoute(path) {
  var baseUrl = process.env.OCM_INTERNAL_API_URL
  var token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) {
    throw new Error('The OpenCode Manager internal API is not configured for this OpenCode server.')
  }
  var base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
  var url
  try {
    url = new URL(String(path).replace(/^\\/+/, ''), base)
  } catch (error) {
    throw new Error('The path ' + String(path) + ' is not a valid OpenCode Manager internal API path.')
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error('The path ' + String(path) + ' resolves outside the OpenCode Manager internal API.')
  }
  return { url: url, token: token, routePath: '/' + url.pathname.slice(base.pathname.length) }
}

function assertAllowedRoute(method, path) {
  var resolved = resolveRoute(path)
  var allowed = ALLOWED_MATCHERS.some(function (matcher) {
    return matcher.method === method && matcher.pattern.test(resolved.routePath)
  })
  if (!allowed) {
    throw new Error(
      method + ' ' + resolved.routePath + ' is not an allowed OpenCode Manager route. Allowed routes: ' + ALLOWED_ROUTES.join(', ') + '.',
    )
  }
  return resolved
}

async function requestInternalApi(method, path, body, signal) {
  var resolved = resolveRoute(path)
  var headers = { Authorization: 'Bearer ' + resolved.token }
  var init = {
    method: method,
    headers: headers,
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  var response
  try {
    response = await fetch(resolved.url.toString(), init)
  } catch (error) {
    throw new Error('The OpenCode Manager request failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  var text = await response.text()
  if (!response.ok) {
    throw new Error('The OpenCode Manager request failed with status ' + response.status + (text ? ': ' + text : ''))
  }
  return text
}

async function postInternalApi(routePath, body, signal) {
  return await requestInternalJson('POST', routePath, body, signal)
}

async function getInternalApi(routePath, signal) {
  return await requestInternalJson('GET', routePath, undefined, signal)
}

async function requestInternalJson(method, routePath, body, signal) {
  var text = await requestInternalApi(method, routePath, body, signal)
  try {
    return JSON.parse(text)
  } catch (error) {
    return {}
  }
}

function outputQuery(definitionId, params) {
  var query = '?definitionId=' + encodeURIComponent(definitionId)
  if (params !== undefined) {
    query += '&params=' + encodeURIComponent(JSON.stringify(params))
  }
  return query
}

/** Waits one output poll interval, rejecting promptly when the signal aborts. */
function waitForOutputPoll(signal) {
  return new Promise(function (resolve, reject) {
    var timer
    function onAbort() {
      clearTimeout(timer)
      reject(new Error('The output wait was aborted before it was ready.'))
    }
    if (signal.aborted) {
      reject(new Error('The output wait was aborted before it was ready.'))
      return
    }
    timer = setTimeout(function () {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, OUTPUT_POLL_INTERVAL_MS)
    signal.addEventListener('abort', onAbort)
  })
}

var ACTIONS = {
  send_notification: {
    run: async function (params, context) {
      var body = Object.assign({}, params, { sessionId: context.sessionID })
      var result = await postInternalApi('/notifications/send', body, context.signal)
      if (result.noSubscriptions === true) {
        return 'No devices are registered for push notifications, so nothing was delivered.'
      }
      return 'Notification sent: ' + (result.delivered || 0) + ' delivered, ' + (result.failed || 0) + ' failed.'
    },
  },
  request: {
    run: async function (params, context) {
      assertAllowedRoute(params.method, params.path)
      var text = await requestInternalApi(params.method, params.path, params.body, context.signal)
      return text || 'The request succeeded with an empty response body.'
    },
  },
  open_output: {
    run: async function (params, context) {
      var query = outputQuery(params.definitionId, params.params)
      var outputPath = '/outputs/' + encodeURIComponent(context.sessionID)
      var state = await getInternalApi(outputPath + query, context.signal)
      if (state.definition && state.definition.generation === 'currentSession') {
        var publishArgs = 'definitionId: "' + params.definitionId + '"'
        if (params.params !== undefined) {
          publishArgs += ', params: ' + JSON.stringify(params.params)
        }
        var lines = []
        if (state.definition.renderer && state.definition.renderer.kind === 'html') {
          lines.push('Write one self-contained .html file, then publish it with publish_output { ' + publishArgs + ', path }.')
        } else {
          lines.push('Publish it with publish_output { ' + publishArgs + ', data }, where the data matches this JSON Schema:')
          lines.push(JSON.stringify(state.definition.dataSchema || {}, null, 2))
        }
        return {
          content: [state.definition.instructions || ''].concat(lines).join('\\n\\n'),
          metadata: { definitionId: params.definitionId, params: params.params },
        }
      }
      var body = { definitionId: params.definitionId }
      if (params.params !== undefined) {
        body.params = params.params
      }
      state = await postInternalApi(outputPath, body, context.signal)
      while (state.generating === true) {
        await waitForOutputPoll(context.signal)
        state = await getInternalApi(outputPath + query, context.signal)
      }
      var hint = ' It opens in the Manager Outputs panel when this session is open on desktop; otherwise the user can open it from this tool call.'
      if (state.output && state.output.status === 'ready') {
        return 'The output is ready.' + hint
      }
      var failure = state.error || (state.output && state.output.error)
      if (failure || (state.output && state.output.status === 'failed')) {
        throw new Error('The output failed: ' + (failure && failure.message ? failure.message : 'unknown error'))
      }
      throw new Error('The output was cancelled before it was ready.')
    },
  },
  show_artifact: {
    run: async function (params, context) {
      var result = await postInternalApi(
        '/session-artifacts/' + encodeURIComponent(context.sessionID) + '/resolve',
        { path: params.path },
        context.signal,
      )
      return {
        content: 'Showing the artifact "' + params.title + '" from ' + result.path + ' in the Manager chat. It renders the current file contents, so after editing the file the user can reload the view; call show_artifact again only to show a different file.',
        metadata: { path: result.path },
      }
    },
  },
  define_output: {
    run: async function (params, context) {
      var result = await postInternalApi('/output-actions/' + encodeURIComponent(context.sessionID) + '/define', params, context.signal)
      return 'Defined the output "' + result.definition.id + '" for this session.'
    },
  },
  read_output_input: {
    run: async function (params, context) {
      var body = params.file === undefined ? undefined : { file: params.file }
      var result = await postInternalApi('/output-actions/' + encodeURIComponent(context.sessionID) + '/input', body, context.signal)
      return result.text
    },
  },
  publish_output: {
    run: async function (params, context) {
      var result = await postInternalApi('/output-actions/' + encodeURIComponent(context.sessionID) + '/publish', params, context.signal)
      var content = 'Published the output from ' + result.outputDir + '. The Manager Outputs panel renders it; edit it and call publish_output again after significant changes.'
      var uncovered = result.uncoveredHunkIds || []
      if (uncovered.length > 0) {
        content += ' Unreferenced hunks: ' + uncovered.join(', ') + '. They are shown under Other changes; add them to stops if they matter.'
      }
      var metadata = { outputDir: result.outputDir }
      if (params.definitionId !== undefined) {
        metadata.definitionId = params.definitionId
      }
      if (params.params !== undefined) {
        metadata.params = params.params
      }
      return { content: content, metadata: metadata }
    },
  },
}

function assertParams(actionName, params) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('Invalid parameters for OpenCode Manager action: ' + actionName + '.')
  }
  var required = ACTION_REQUIRED_KEYS[actionName]
  for (var index = 0; index < required.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(params, required[index])) {
      throw new Error(
        'Invalid parameters for OpenCode Manager action: ' + actionName + '. Missing required parameter: ' + required[index] + '.',
      )
    }
  }
}

async function runAction(input, context) {
  var actionName = input !== null && typeof input === 'object' ? input.action : undefined
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, actionName)) {
    throw new Error('Unknown OpenCode Manager action: ' + String(actionName) + '. Supported actions: ' + ACTION_NAMES.join(', ') + '.')
  }
  var params = input.params
  assertParams(actionName, params)
  return await ACTIONS[actionName].run(params, context)
}

export default {
  id: '${id}',
  /** Registers session hooks and exposes the manager tool through the plugin context. */
  async setup(ctx) {
    await ctx.session.hook('prompt', trackMobileSession)
    await ctx.session.hook('context', addMobileOutputInstructions)
    await ctx.tool.transform(function (editor) {
      editor.add({
        name: ${JSON.stringify(MANAGER_TOOL_NAME)},
        description: DESCRIPTION,
        input: INPUT_SCHEMA,
        options: { codemode: false },
        execute: async function (input, context) {
          var result = await runAction(input, context)
          if (result !== null && typeof result === 'object') {
            return result
          }
          return { content: result }
        },
      })
    })
  },
}
`
}
