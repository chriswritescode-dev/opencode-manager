import { ASSISTANT_NOTIFICATION_LIMITS } from '@opencode-manager/shared/schemas'

export const MANAGER_TOOL_NAME = 'ocm'

export const MANAGER_TOOL_REQUEST_TIMEOUT_MS = 15000

export const MANAGER_TOOL_ALLOWED_ROUTES = [
  'GET /settings',
  'PATCH /settings',
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

export const MANAGER_TOOL_ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const

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

export function buildManagerToolPluginSource(): string {
  return `import { z } from 'zod'

var REQUEST_TIMEOUT_MS = ${MANAGER_TOOL_REQUEST_TIMEOUT_MS}

var ALLOWED_ROUTES = ${JSON.stringify(MANAGER_TOOL_ALLOWED_ROUTES)}

var ALLOWED_MATCHERS = ${JSON.stringify(buildRouteMatchers())}.map(function (matcher) {
  return { method: matcher.method, pattern: new RegExp(matcher.source) }
})

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

async function requestInternalApi(method, path, body) {
  var resolved = resolveRoute(path)
  var headers = { Authorization: 'Bearer ' + resolved.token }
  var init = { method: method, headers: headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
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

async function postInternalApi(routePath, body) {
  var text = await requestInternalApi('POST', routePath, body)
  try {
    return JSON.parse(text)
  } catch (error) {
    return {}
  }
}

var ACTIONS = {
  send_notification: {
    params: z.object({
      title: z.string().min(1).max(${ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX}).describe('The notification title.'),
      body: z.string().min(1).max(${ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX}).describe('The notification body.'),
      url: z.string().min(1).max(${ASSISTANT_NOTIFICATION_LIMITS.URL_MAX}).optional().describe('A deep link to open, such as /repos/my-repo.'),
      tag: z.string().max(${ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX}).optional().describe('A deduplication key for replacing an earlier notification.'),
      priority: z.enum(['normal', 'high']).optional().describe('Use high for something that should interrupt the user.'),
    }).describe('Send a push notification to every device the user has registered.'),
    run: async function (params) {
      var result = await postInternalApi('/notifications/send', params)
      if (result.noSubscriptions === true) {
        return 'No devices are registered for push notifications, so nothing was delivered.'
      }
      return 'Notification sent: ' + (result.delivered || 0) + ' delivered, ' + (result.failed || 0) + ' failed.'
    },
  },
  request: {
    params: z.object({
      method: z.enum(${JSON.stringify(MANAGER_TOOL_ALLOWED_METHODS)}).describe('The HTTP method for the internal API route.'),
      path: z.string().min(1).max(500).describe('The internal API route path, such as /settings or /repos/0/schedules. Query strings are allowed.'),
      body: z.record(z.string(), z.unknown()).optional().describe('The JSON request body, for POST and PATCH routes.'),
    }).describe('Call an allow-listed OpenCode Manager internal API route.'),
    run: async function (params) {
      assertAllowedRoute(params.method, params.path)
      var text = await requestInternalApi(params.method, params.path, params.body)
      return text || 'The request succeeded with an empty response body.'
    },
  },
}

var ACTION_NAMES = Object.keys(ACTIONS)

export default async function () {
  return {
    tool: {
      ${MANAGER_TOOL_NAME}: {
        description: [
          'Perform an OpenCode Manager action.',
          'The action runs inside OpenCode Manager itself, so it needs no token and no network access from the agent shell, and it works in sandboxed sessions and scheduled runs.',
          'Actions:',
          '- send_notification: send a push notification to every device the user has registered.',
          '- request: call an allow-listed internal API route to read and manage settings, repos, OpenCode workspaces, and schedules.',
          'Allowed request routes:',
        ].concat(ALLOWED_ROUTES.map(function (route) { return '- ' + route })).join('\\n'),
        args: {
          action: z.enum(ACTION_NAMES).describe('The OpenCode Manager action to perform.'),
          params: z.union(ACTION_NAMES.map(function (name) { return ACTIONS[name].params })).describe('The parameters for the chosen action.'),
        },
        execute: async function (args) {
          if (!Object.prototype.hasOwnProperty.call(ACTIONS, args.action)) {
            throw new Error('Unknown OpenCode Manager action: ' + String(args.action) + '. Supported actions: ' + ACTION_NAMES.join(', ') + '.')
          }
          var action = ACTIONS[args.action]
          return await action.run(action.params.parse(args.params))
        },
      },
    },
  }
}
`
}
