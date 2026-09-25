import { z } from 'zod'
import { ASSISTANT_NOTIFICATION_LIMITS } from '@opencode-manager/shared/schemas'

export const MANAGER_TOOL_NAME = 'ocm'

const MANAGER_TOOL_REQUEST_TIMEOUT_MS = 15000

export const MANAGER_TOOL_ALLOWED_ROUTES = [
  'GET /settings',
  'PATCH /settings',
  'GET /opencode-config',
  'GET /opencode-config/effective',
  'PUT /opencode-config',
  'POST /assistant/reload',
  'GET /repos',
  'GET /repos/*/git-info',
  'GET /opencode-workspaces',
  'GET /schedules/all',
  'GET /schedules/all/runs',
  'GET /repos/*/schedules',
  'POST /repos/*/schedules',
  'GET /repos/*/schedules/*',
  'PATCH /repos/*/schedules/*',
  'DELETE /repos/*/schedules/*',
  'POST /repos/*/schedules/*/run',
  'GET /repos/*/schedules/*/runs',
  'DELETE /repos/*/schedules/*/runs',
  'GET /repos/*/schedules/*/runs/*',
  'DELETE /repos/*/schedules/*/runs/*',
  'POST /repos/*/schedules/*/runs/*/cancel',
] as const

const MANAGER_TOOL_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const MANAGER_TOOL_ACTION_NAMES = ['send_notification', 'request'] as const

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

const MANAGER_TOOL_ACTION_PARAMS_SCHEMAS: Record<(typeof MANAGER_TOOL_ACTION_NAMES)[number], z.ZodType> = {
  send_notification: ManagerToolNotificationParamsSchema,
  request: ManagerToolRequestParamsSchema,
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
        action: z.enum(MANAGER_TOOL_ACTION_NAMES).describe('The OpenCode Manager action to perform.'),
        params: z
          .union([MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.send_notification, MANAGER_TOOL_ACTION_PARAMS_SCHEMAS.request])
          .describe('The parameters for the chosen action.'),
      })
      .strict(),
  )
  delete jsonSchema.$schema
  return jsonSchema
}

function buildManagerToolActionRequiredKeys(): Record<string, string[]> {
  return Object.fromEntries(MANAGER_TOOL_ACTION_NAMES.map((name) => [name, requiredKeysOf(MANAGER_TOOL_ACTION_PARAMS_SCHEMAS[name])]))
}

function buildManagerToolDescription(): string {
  return [
    'Perform an OpenCode Manager action.',
    'The action runs inside OpenCode Manager itself, so it needs no token and no network access from the agent shell, and it works in sandboxed sessions and scheduled runs.',
    'Actions:',
    '- send_notification: send a push notification to every device the user has registered.',
    '- request: call an allow-listed internal API route to read and manage settings, the OpenCode configuration file, repos, OpenCode workspaces, and schedules.',
    'Allowed request routes:',
  ]
    .concat(MANAGER_TOOL_ALLOWED_ROUTES.map((route) => `- ${route}`))
    .join('\n')
}

export function buildManagerToolPluginSource(id: string): string {
  return `var REQUEST_TIMEOUT_MS = ${MANAGER_TOOL_REQUEST_TIMEOUT_MS}

var ALLOWED_ROUTES = ${JSON.stringify(MANAGER_TOOL_ALLOWED_ROUTES)}

var ALLOWED_MATCHERS = ${JSON.stringify(buildRouteMatchers())}.map(function (matcher) {
  return { method: matcher.method, pattern: new RegExp(matcher.source) }
})

var ACTION_NAMES = ${JSON.stringify(MANAGER_TOOL_ACTION_NAMES)}

var ACTION_REQUIRED_KEYS = ${JSON.stringify(buildManagerToolActionRequiredKeys())}

var INPUT_SCHEMA = ${JSON.stringify(buildManagerToolInputJsonSchema(), null, 2)}

var DESCRIPTION = ${JSON.stringify(buildManagerToolDescription())}

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
  var text = await requestInternalApi('POST', routePath, body, signal)
  try {
    return JSON.parse(text)
  } catch (error) {
    return {}
  }
}

var ACTIONS = {
  send_notification: {
    run: async function (params, signal) {
      var result = await postInternalApi('/notifications/send', params, signal)
      if (result.noSubscriptions === true) {
        return 'No devices are registered for push notifications, so nothing was delivered.'
      }
      return 'Notification sent: ' + (result.delivered || 0) + ' delivered, ' + (result.failed || 0) + ' failed.'
    },
  },
  request: {
    run: async function (params, signal) {
      assertAllowedRoute(params.method, params.path)
      var text = await requestInternalApi(params.method, params.path, params.body, signal)
      return text || 'The request succeeded with an empty response body.'
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

async function runAction(input, signal) {
  var actionName = input !== null && typeof input === 'object' ? input.action : undefined
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, actionName)) {
    throw new Error('Unknown OpenCode Manager action: ' + String(actionName) + '. Supported actions: ' + ACTION_NAMES.join(', ') + '.')
  }
  var params = input.params
  assertParams(actionName, params)
  return await ACTIONS[actionName].run(params, signal)
}

export default {
  id: '${id}',
  async setup(ctx) {
    await ctx.tool.transform(function (editor) {
      editor.add({
        name: ${JSON.stringify(MANAGER_TOOL_NAME)},
        description: DESCRIPTION,
        input: INPUT_SCHEMA,
        options: { codemode: false },
        execute: async function (input, context) {
          return { content: await runAction(input, context.signal) }
        },
      })
    })
  },
}
`
}
