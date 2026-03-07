import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { DevcontainerManager } from '../services/devcontainer-manager'
import type { DevcontainerConfig, CreateDevcontainerTemplateInput } from '@opencode-manager/shared'
import { logger } from '../utils/logger'

export function createDevcontainerRoutes(db: Database, devcontainerManager: DevcontainerManager) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const templates = await devcontainerManager.listTemplates()
      return c.json(templates)
    } catch (error) {
      logger.error('Failed to list templates:', error)
      return c.json({ 
        error: 'Failed to list templates',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.get('/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const template = await devcontainerManager.getTemplate(name)
      
      if (!template) {
        return c.json({ error: 'Template not found' }, 404)
      }
      
      return c.json(template)
    } catch (error) {
      logger.error('Failed to get template:', error)
      return c.json({ 
        error: 'Failed to get template',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json() as CreateDevcontainerTemplateInput
      
      const template = await devcontainerManager.createTemplate(
        body.name,
        body.config,
        body.basedOn
      )
      
      return c.json(template, 201)
    } catch (error) {
      logger.error('Failed to create template:', error)
      return c.json({ 
        error: 'Failed to create template',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.put('/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const body = await c.req.json() as { config: DevcontainerConfig }
      
      await devcontainerManager.updateTemplate(name, body.config)
      
      const updated = await devcontainerManager.getTemplate(name)
      return c.json(updated)
    } catch (error) {
      logger.error('Failed to update template:', error)
      return c.json({ 
        error: 'Failed to update template',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:name/fork', async (c) => {
    try {
      const originalName = c.req.param('name')
      const body = await c.req.json() as { newName: string }
      
      const forked = await devcontainerManager.forkTemplate(originalName, body.newName)
      
      return c.json(forked, 201)
    } catch (error) {
      logger.error('Failed to fork template:', error)
      return c.json({ 
        error: 'Failed to fork template',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.delete('/:name', async (c) => {
    try {
      const name = c.req.param('name')
      
      await devcontainerManager.deleteTemplate(name)
      
      return c.json({ success: true, deleted: true })
    } catch (error) {
      logger.error('Failed to delete template:', error)
      return c.json({ 
        error: 'Failed to delete template',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  return app
}
