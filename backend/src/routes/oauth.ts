import { Hono } from 'hono'
import { z } from 'zod'
import {
  OAuthAuthorizeRequestSchema,
  OAuthCallbackRequestSchema,
} from '../../../shared/src/schemas/auth'
import type { ProviderAuthMethod } from '../../../shared/src/schemas/auth'
import type { FormField, IntegrationMethod } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../services/opencode/client'
import { handleOpenCodeError } from '../utils/route-helpers'

function finiteNumber(value: number | string | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function promptField(field: FormField) {
  const message = field.title ?? field.description ?? field.key

  if (field.type === 'external') {
    return { type: 'external' as const, key: field.key, message, url: field.url }
  }

  const condition = field.when?.map((when) => ({ key: when.key, op: when.op, value: when.value }))

  if (field.type === 'string' && field.options) {
    return {
      type: 'select' as const,
      key: field.key,
      message,
      options: field.options.map(({ label, value }) => ({ label, value })),
      required: field.required,
      default: field.default,
      when: condition,
    }
  }

  if (field.type === 'string') {
    return {
      type: 'text' as const,
      key: field.key,
      message,
      placeholder: field.placeholder,
      required: field.required,
      default: field.default,
      when: condition,
    }
  }

  if (field.type === 'boolean') {
    return { type: 'boolean' as const, key: field.key, message, required: field.required, default: field.default, when: condition }
  }

  if (field.type === 'multiselect') {
    return {
      type: 'multiselect' as const,
      key: field.key,
      message,
      options: field.options.map(({ label, value }) => ({ label, value })),
      required: field.required,
      default: field.default,
      when: condition,
    }
  }

  return {
    type: 'number' as const,
    key: field.key,
    message,
    minimum: finiteNumber(field.minimum),
    maximum: finiteNumber(field.maximum),
    required: field.required,
    default: finiteNumber(field.default),
    when: condition,
  }
}

function providerAuthMethod(method: IntegrationMethod): ProviderAuthMethod {
  if (method.type === 'env') {
    return { id: 'env', type: 'env', label: method.names.join(', ') }
  }

  const fields = method.type === 'oauth' || method.type === 'key'
    ? method.form
      ?.filter((field) => field.type === 'external' || !field.hidden)
      .map(promptField)
    : undefined

  if (method.type === 'command') {
    return { id: method.id, type: 'command', label: method.label, fields }
  }

  if (method.type === 'oauth') {
    return { id: method.id, type: 'oauth', label: method.label, fields }
  }

  return { id: 'key', type: 'key', label: method.label ?? 'API key', fields }
}

export function createOAuthRoutes(openCodeClient: OpenCodeClient) {
  const app = new Hono()

  app.get('/auth-methods', async (c) => {
    try {
      const integrations = await openCodeClient.api.integration.list()
      const providers = Object.fromEntries(
        integrations.data.map((integration) => [
          integration.id,
          integration.methods.map(providerAuthMethod),
        ]),
      )
      return c.json({ providers })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to get provider auth methods')
    }
  })

  app.post('/:id/oauth/authorize', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OAuthAuthorizeRequestSchema.parse(body)

      const attempt = await openCodeClient.api.integration.oauth.connect({
        integrationID: c.req.param('id'),
        methodID: validated.methodID,
        answer: validated.answer,
      })

      return c.json({
        attemptID: attempt.data.attemptID,
        url: attempt.data.url,
        instructions: attempt.data.instructions,
        mode: attempt.data.mode,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return handleOpenCodeError(c, error, 'OAuth authorization failed')
    }
  })

  app.get('/:id/oauth/:attemptID', async (c) => {
    try {
      const attempt = await openCodeClient.api.integration.oauth.status({
        integrationID: c.req.param('id'),
        attemptID: c.req.param('attemptID'),
      })

      const { status } = attempt.data
      return c.json(status === 'failed'
        ? { status, message: attempt.data.message }
        : { status })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to get OAuth status')
    }
  })

  app.post('/:id/oauth/callback', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OAuthCallbackRequestSchema.parse(body)

      await openCodeClient.api.integration.oauth.complete({
        integrationID: c.req.param('id'),
        attemptID: validated.attemptID,
        code: validated.code,
      })

      return c.json({ success: true })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return handleOpenCodeError(c, error, 'OAuth callback failed')
    }
  })

  app.delete('/:id/oauth/:attemptID', async (c) => {
    try {
      await openCodeClient.api.integration.oauth.cancel({
        integrationID: c.req.param('id'),
        attemptID: c.req.param('attemptID'),
      })

      return c.json({ success: true })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to cancel OAuth authorization')
    }
  })

  return app
}
