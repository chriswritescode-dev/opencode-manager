import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { writeFileContent } from '../services/file-operations'
import { patchOpenCodeConfig } from '../services/proxy'
import { getOpenCodeConfigFilePath } from '@opencode-webui/shared'
import { 
  UserPreferencesSchema, 
  OpenCodeConfigSchema,
} from '../types/settings'
import { logger } from '../utils/logger'
import { opencodeServerManager } from '../services/opencode-single-server'

const UpdateSettingsSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
})

const CreateOpenCodeConfigSchema = z.object({
  name: z.string().min(1).max(255),
  content: OpenCodeConfigSchema,
  isDefault: z.boolean().optional(),
})

const UpdateOpenCodeConfigSchema = z.object({
  content: OpenCodeConfigSchema,
  isDefault: z.boolean().optional(),
})



const CreateCustomCommandSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})

const UpdateCustomCommandSchema = z.object({
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})

export function createSettingsRoutes(db: Database) {
  const app = new Hono()
  const settingsService = new SettingsService(db)

  app.get('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.getSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to get settings:', error)
      return c.json({ error: 'Failed to get settings' }, 500)
    }
  })

  app.patch('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = UpdateSettingsSchema.parse(body)
      
      const currentSettings = settingsService.getSettings(userId)
      const settings = settingsService.updateSettings(validated.preferences, userId)
      
      let serverRestarted = false
      if (validated.preferences.gitToken !== undefined && 
          validated.preferences.gitToken !== currentSettings.preferences.gitToken) {
        logger.info('GitHub token changed, restarting OpenCode server')
        await opencodeServerManager.restart()
        serverRestarted = true
      }
      
      return c.json({ ...settings, serverRestarted })
    } catch (error) {
      logger.error('Failed to update settings:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid settings data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update settings' }, 500)
    }
  })

  app.delete('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.resetSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to reset settings:', error)
      return c.json({ error: 'Failed to reset settings' }, 500)
    }
  })

  // OpenCode Config routes
  app.get('/opencode-configs', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configs = settingsService.getOpenCodeConfigs(userId)
      return c.json(configs)
    } catch (error) {
      logger.error('Failed to get OpenCode configs:', error)
      return c.json({ error: 'Failed to get OpenCode configs' }, 500)
    }
  })

  app.post('/opencode-configs', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = CreateOpenCodeConfigSchema.parse(body)
      
      const config = settingsService.createOpenCodeConfig(validated, userId)
      
      if (config.isDefault) {
        const configPath = getOpenCodeConfigFilePath()
        const configContent = JSON.stringify(config.content, null, 2)
        await writeFileContent(configPath, configContent)
        logger.info(`Wrote default config to: ${configPath}`)
        
        await patchOpenCodeConfig(config.content)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to create OpenCode config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to create OpenCode config' }, 500)
    }
  })

  app.put('/opencode-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      const body = await c.req.json()
      const validated = UpdateOpenCodeConfigSchema.parse(body)
      
      const existingConfig = settingsService.getOpenCodeConfigByName(configName, userId)
      const config = settingsService.updateOpenCodeConfig(configName, validated, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      if (config.isDefault) {
        const configPath = getOpenCodeConfigFilePath()
        const configContent = JSON.stringify(config.content, null, 2)
        await writeFileContent(configPath, configContent)
        logger.info(`Wrote default config to: ${configPath}`)
        
        await patchOpenCodeConfig(config.content)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to update OpenCode config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode config' }, 500)
    }
  })

  app.delete('/opencode-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      
      const deleted = settingsService.deleteOpenCodeConfig(configName, userId)
      if (!deleted) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete OpenCode config:', error)
      return c.json({ error: 'Failed to delete OpenCode config' }, 500)
    }
  })

  app.post('/opencode-configs/:name/set-default', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      
      const config = settingsService.setDefaultOpenCodeConfig(configName, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      const configPath = getOpenCodeConfigFilePath()
      const configContent = JSON.stringify(config.content, null, 2)
      await writeFileContent(configPath, configContent)
      logger.info(`Wrote default config '${configName}' to: ${configPath}`)
      
      await patchOpenCodeConfig(config.content)
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to set default OpenCode config:', error)
      return c.json({ error: 'Failed to set default OpenCode config' }, 500)
    }
  })

  app.get('/opencode-configs/default', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const config = settingsService.getDefaultOpenCodeConfig(userId)
      
      if (!config) {
        return c.json({ error: 'No default config found' }, 404)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get default OpenCode config:', error)
      return c.json({ error: 'Failed to get default OpenCode config' }, 500)
    }
  })

  app.post('/opencode-restart', async (c) => {
    try {
      logger.info('Manual OpenCode server restart requested')
      await opencodeServerManager.restart()
      return c.json({ success: true, message: 'OpenCode server restarted successfully' })
    } catch (error) {
      logger.error('Failed to restart OpenCode server:', error)
      return c.json({ error: 'Failed to restart OpenCode server' }, 500)
    }
  })

  // Custom Commands routes
  app.get('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.getSettings(userId)
      return c.json(settings.preferences.customCommands)
    } catch (error) {
      logger.error('Failed to get custom commands:', error)
      return c.json({ error: 'Failed to get custom commands' }, 500)
    }
  })

  app.post('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = CreateCustomCommandSchema.parse(body)
      
      const settings = settingsService.getSettings(userId)
      const existingCommand = settings.preferences.customCommands.find(cmd => cmd.name === validated.name)
      if (existingCommand) {
        return c.json({ error: 'Command with this name already exists' }, 409)
      }
      
      settingsService.updateSettings({
        customCommands: [...settings.preferences.customCommands, validated]
      }, userId)
      
      return c.json(validated)
    } catch (error) {
      logger.error('Failed to create custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to create custom command' }, 500)
    }
  })

  app.put('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      const body = await c.req.json()
      const validated = UpdateCustomCommandSchema.parse(body)
      
      const settings = settingsService.getSettings(userId)
      const commandIndex = settings.preferences.customCommands.findIndex(cmd => cmd.name === commandName)
      if (commandIndex === -1) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = [...settings.preferences.customCommands]
      updatedCommands[commandIndex] = {
        name: commandName,
        description: validated.description,
        promptTemplate: validated.promptTemplate
      }
      
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json(updatedCommands[commandIndex])
    } catch (error) {
      logger.error('Failed to update custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update custom command' }, 500)
    }
  })

  app.delete('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      
      const settings = settingsService.getSettings(userId)
      const commandExists = settings.preferences.customCommands.some(cmd => cmd.name === commandName)
      if (!commandExists) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = settings.preferences.customCommands.filter(cmd => cmd.name !== commandName)
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete custom command:', error)
      return c.json({ error: 'Failed to delete custom command' }, 500)
    }
  })

  return app
}
