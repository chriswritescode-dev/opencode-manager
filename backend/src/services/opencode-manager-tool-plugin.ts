import { ASSISTANT_NOTIFICATION_LIMITS } from '@opencode-manager/shared/schemas'

export const MANAGER_TOOL_NAME = 'ocm'

export const MANAGER_TOOL_REQUEST_TIMEOUT_MS = 15000

export function buildManagerToolPluginSource(): string {
  return `import { z } from 'zod'

var REQUEST_TIMEOUT_MS = ${MANAGER_TOOL_REQUEST_TIMEOUT_MS}

async function postInternalApi(routePath, body) {
  var baseUrl = process.env.OCM_INTERNAL_API_URL
  var token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) {
    throw new Error('The OpenCode Manager internal API is not configured for this OpenCode server.')
  }
  var response
  try {
    response = await fetch(baseUrl + routePath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error('The OpenCode Manager request failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  var text = await response.text()
  if (!response.ok) {
    throw new Error('The OpenCode Manager request failed with status ' + response.status + (text ? ': ' + text : ''))
  }
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
        ].join('\\n'),
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
