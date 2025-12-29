import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { writeFileContent, readFileContent, fileExists } from '../services/file-operations'
import { patchOpenCodeConfig, proxyToOpenCodeWithDirectory } from '../services/proxy'
import { getOpenCodeConfigFilePath, getAgentsMdPath } from '@opencode-manager/shared/config/env'
import { 
  UserPreferencesSchema, 
  OpenCodeConfigSchema,
} from '../types/settings'
import { logger } from '../utils/logger'
import { opencodeServerManager } from '../services/opencode-single-server'
import { DEFAULT_AGENTS_MD } from '../index'
import { createGitHubGitEnv } from '../utils/git-auth'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const UpdateSettingsSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
})

const CreateOpenCodeConfigSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
})

const UpdateOpenCodeConfigSchema = z.object({
  content: z.union([OpenCodeConfigSchema, z.string()]),
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

const ValidateGitTokenSchema = z.object({
  gitToken: z.string(),
})

const ConnectMcpDirectorySchema = z.object({
  directory: z.string().min(1),
})

async function extractOpenCodeError(response: Response, defaultError: string): Promise<string> {
  const errorObj = await response.json().catch(() => null)
  return (errorObj && typeof errorObj === 'object' && 'error' in errorObj)
    ? String(errorObj.error)
    : defaultError
}

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
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409)
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

      settingsService.saveLastKnownGoodConfig(userId)

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
      opencodeServerManager.clearStartupError()
      await opencodeServerManager.restart()
      return c.json({ success: true, message: 'OpenCode server restarted successfully' })
    } catch (error) {
      logger.error('Failed to restart OpenCode server:', error)
      const startupError = opencodeServerManager.getLastStartupError()
      return c.json({
        error: 'Failed to restart OpenCode server',
        details: startupError || (error instanceof Error ? error.message : 'Unknown error')
      }, 500)
    }
  })

  app.post('/opencode-rollback', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      logger.info('OpenCode config rollback requested')

      const rollbackConfig = settingsService.rollbackToLastKnownGoodHealth(userId)
      if (!rollbackConfig) {
        return c.json({ error: 'No previous working config available for rollback' }, 404)
      }

      const configPath = getOpenCodeConfigFilePath()
      const config = settingsService.getDefaultOpenCodeConfig(userId)
      if (!config) {
        return c.json({ error: 'Failed to get default config after rollback' }, 500)
      }

      const configContent = JSON.stringify(config.content, null, 2)
      await writeFileContent(configPath, configContent)
      logger.info(`Rolled back to config '${rollbackConfig}'`)

      opencodeServerManager.clearStartupError()
      try {
        await opencodeServerManager.restart()
      } catch (restartError) {
        logger.error('Rollback config also failed to start server, attempting fallback:', restartError)

        const deleted = settingsService.deleteFilesystemConfig()
        if (deleted) {
          logger.info('Deleted filesystem config, attempting restart with fallback')
          await new Promise(r => setTimeout(r, 1000))

          opencodeServerManager.clearStartupError()
          await opencodeServerManager.restart()

          return c.json({
            success: true,
            message: `Server restarted after deleting problematic config. DB config '${rollbackConfig}' preserved for manual recovery.`,
            fallback: true,
            configName: rollbackConfig
          })
        }

        return c.json({
          error: 'Failed to rollback and could not delete filesystem config',
          details: restartError instanceof Error ? restartError.message : 'Unknown error'
        }, 500)
      }

      return c.json({
        success: true,
        message: `Server restarted with previous working config: ${rollbackConfig}`,
        configName: rollbackConfig
      })
    } catch (error) {
      logger.error('Failed to rollback OpenCode config:', error)
      return c.json({ error: 'Failed to rollback OpenCode config' }, 500)
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

  app.get('/agents-md', async (c) => {
    try {
      const agentsMdPath = getAgentsMdPath()
      const exists = await fileExists(agentsMdPath)
      
      if (!exists) {
        return c.json({ content: '' })
      }
      
      const content = await readFileContent(agentsMdPath)
      return c.json({ content })
    } catch (error) {
      logger.error('Failed to get AGENTS.md:', error)
      return c.json({ error: 'Failed to get AGENTS.md' }, 500)
    }
  })

  app.get('/agents-md/default', async (c) => {
    return c.json({ content: DEFAULT_AGENTS_MD })
  })

  app.put('/agents-md', async (c) => {
    try {
      const body = await c.req.json()
      const { content } = z.object({ content: z.string() }).parse(body)
      
      const agentsMdPath = getAgentsMdPath()
      await writeFileContent(agentsMdPath, content)
      logger.info(`Updated AGENTS.md at: ${agentsMdPath}`)
      
      await opencodeServerManager.restart()
      logger.info('Restarted OpenCode server after AGENTS.md update')
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to update AGENTS.md:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update AGENTS.md' }, 500)
    }
  })

  app.post('/validate-git-token', async (c) => {
    try {
      const body = await c.req.json()
      const { gitToken } = ValidateGitTokenSchema.parse(body)
      
      if (!gitToken) {
        return c.json({ valid: true, message: 'No token provided' })
      }

      // Test the token by trying to access a public GitHub repo via git ls-remote
      const testRepoUrl = 'https://github.com/octocat/Hello-World.git'
      const env = createGitHubGitEnv(gitToken)
      
      try {
        await execAsync(`git ls-remote ${testRepoUrl}`, { 
          env: { ...process.env, ...env },
          timeout: 10000
        })
        
        // If command succeeded (exit code 0), token is valid
        // stderr may contain warnings but that's ok
        return c.json({ 
          valid: true, 
          message: 'Token is valid' 
        })
      } catch (error) {
        logger.error('Git token validation failed:', error)
        
        if (error instanceof Error) {
          const errorMsg = error.message.toLowerCase()
          
          if (errorMsg.includes('authentication failed') || 
              errorMsg.includes('not authorized') ||
              errorMsg.includes('invalid username or token') ||
              errorMsg.includes('password authentication is not supported') ||
              errorMsg.includes('401') ||
              errorMsg.includes('403') ||
              errorMsg.includes('code 128')) {
            return c.json({ 
              valid: false, 
              message: 'Invalid GitHub token. Please check your token and permissions.' 
            })
          }
          
          if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
            return c.json({ 
              valid: false, 
              message: 'Network error - could not validate token. Please try again.' 
            })
          }
        }
        
        return c.json({ 
          valid: false, 
          message: 'Failed to validate token: ' + (error instanceof Error ? error.message : 'Unknown error')
        })
      }
    } catch (error) {
      logger.error('Token validation endpoint error:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to validate token' }, 500)
    }
  })

  // MCP directory-aware endpoints
  app.post('/mcp/:name/connectdirectory', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToOpenCodeWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/connect`,
        'POST',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to connect MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to connect MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to connect MCP server' }, 500)
    }
  })

  app.post('/mcp/:name/disconnectdirectory', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToOpenCodeWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/disconnect`,
        'POST',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to disconnect MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to disconnect MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to disconnect MCP server' }, 500)
    }
  })

  app.post('/mcp/:name/authdirectedir', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToOpenCodeWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/auth/authenticate`,
        'POST',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to authenticate MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json(await response.json())
    } catch (error) {
      logger.error('Failed to authenticate MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to authenticate MCP server' }, 500)
    }
  })

  app.delete('/mcp/:name/authdir', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToOpenCodeWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/auth`,
        'DELETE',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractOpenCodeError(response, 'Failed to remove MCP auth')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to remove MCP auth for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to remove MCP auth' }, 500)
    }
  })

  return app
}
