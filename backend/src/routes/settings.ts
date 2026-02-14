import { Hono } from 'hono'
import { z } from 'zod'
import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { writeFileContent, readFileContent, fileExists } from '../services/file-operations'
import { patchOpenCodeConfig, proxyToOpenCodeWithDirectory } from '../services/proxy'
import { getOpenCodeConfigFilePath, getAgentsMdPath, ENV } from '@opencode-manager/shared/config/env'
import {
  UserPreferencesSchema,
  OpenCodeConfigSchema,
} from '../types/settings'
import type { GitCredential } from '@opencode-manager/shared'
import { logger } from '../utils/logger'
import { opencodeServerManager } from '../services/opencode-single-server'
import { DEFAULT_AGENTS_MD } from '../constants'
import { validateSSHPrivateKey } from '../utils/ssh-validation'
import { encryptSecret } from '../utils/crypto'

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(s => Number(s))
  const parts2 = v2.split('.').map(s => Number(s))

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

function getOpenCodeInstallMethod(): string {
  const homePath = process.env.HOME || ''
  const opencodePath = process.env.OPENCOD_PATH || resolve(homePath, '.opencode', 'bin', 'opencode')
  
  if (!existsSync(opencodePath)) return 'curl'
  
  try {
    const opencodeDir = dirname(opencodePath)
    if (opencodeDir.includes('.opencode')) return 'curl'
    
    if (opencodePath.includes('/homebrew/') || opencodePath.includes('/HOMEBREW/')) return 'brew'
    if (opencodePath.includes('/.npm/') || opencodePath.includes('/node_modules/')) return 'npm'
    if (opencodePath.includes('/.pnpm/')) return 'pnpm'
    if (opencodePath.includes('/.bun/')) return 'bun'
  } catch {
    return 'curl'
  }
  
  return 'curl'
}

function execWithTimeout(command: string, timeoutMs: number, env?: Record<string, string>): { output: string; timedOut: boolean } {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      env: env ? { ...process.env, ...env } : undefined
    })
    return { output, timedOut: false }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === null) {
      return { output: '', timedOut: true }
    }
    if (error && typeof error === 'object' && ('stdout' in error || 'stderr' in error)) {
      const stdout = (error as { stdout?: string }).stdout || ''
      const stderr = (error as { stderr?: string }).stderr || ''
      return { output: stdout + stderr, timedOut: false }
    }
    throw error
  }
}

function spawnWithTimeout(args: string[], timeoutMs: number, env?: Record<string, string>): { output: string; timedOut: boolean } {
  const result = spawnSync(args[0]!, args.slice(1), {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: env ? { ...process.env, ...env } : undefined
  })

  if (result.signal === 'SIGKILL' || result.error?.message?.includes('TIMEOUT')) {
    return { output: '', timedOut: true }
  }

  const output = (result.stdout || '') + (result.stderr || '')
  return { output, timedOut: false }
}

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



const ConnectMcpDirectorySchema = z.object({
  directory: z.string().min(1),
})

const McpAuthDirectorySchema = ConnectMcpDirectorySchema

const TestSSHConnectionSchema = z.object({
  host: z.string().min(1),
  sshPrivateKey: z.string().min(1),
  passphrase: z.string().optional(),
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

      if (validated.preferences.gitCredentials) {
        const validations = await Promise.all(
          validated.preferences.gitCredentials.map(async (cred: GitCredential) => {
            if (cred.type === 'ssh' && cred.sshPrivateKey) {
              const validation = await validateSSHPrivateKey(cred.sshPrivateKey)
              if (!validation.valid) {
                throw new Error(`Invalid SSH key for credential '${cred.name}': ${validation.error}`)
              }

              const result: GitCredential = {
                ...cred,
                sshPrivateKeyEncrypted: encryptSecret(cred.sshPrivateKey),
                hasPassphrase: validation.hasPassphrase,
                passphrase: cred.passphrase ? encryptSecret(cred.passphrase) : undefined,
              }
              delete result.sshPrivateKey
              return result
            }
            return cred
          })
        )
        validated.preferences.gitCredentials = validations
      }

      const currentSettings = settingsService.getSettings(userId)
      const settings = settingsService.updateSettings(validated.preferences, userId)

      let serverRestarted = false

      const credentialsChanged = validated.preferences.gitCredentials !== undefined &&
        JSON.stringify(currentSettings.preferences.gitCredentials || []) !== JSON.stringify(validated.preferences.gitCredentials)

      const identityChanged = validated.preferences.gitIdentity !== undefined &&
        JSON.stringify(currentSettings.preferences.gitIdentity || {}) !== JSON.stringify(validated.preferences.gitIdentity)

      let reloadError: string | undefined
      if (credentialsChanged || identityChanged) {
        const changeType = [credentialsChanged && 'credentials', identityChanged && 'identity'].filter(Boolean).join(' and ')
        logger.info(`Git ${changeType} changed, reloading OpenCode configuration`)
        try {
          await opencodeServerManager.reloadConfig()
          serverRestarted = true
        } catch (error) {
          logger.warn('Failed to reload OpenCode config after git settings change:', error)
          reloadError = error instanceof Error ? error.message : 'Unknown error'
        }
      }

      return c.json({ ...settings, serverRestarted, reloadError })
    } catch (error) {
      logger.error('Failed to update settings:', error)
      if (error instanceof Error && error.message.startsWith('Invalid SSH key')) {
        return c.json({ error: error.message }, 400)
      }
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
        await writeFileContent(configPath, config.rawContent)
        logger.info(`Wrote default config to: ${configPath}`)
        
        const patchResult = await patchOpenCodeConfig(config.content)
        if (!patchResult.success) {
          return c.json({ error: 'Config saved but failed to apply', details: patchResult.error }, 500)
        }
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

  app.get('/opencode-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      
      const config = settingsService.getOpenCodeConfigByName(configName, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get OpenCode config:', error)
      return c.json({ error: 'Failed to get OpenCode config' }, 500)
    }
  })

  app.put('/opencode-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      const body = await c.req.json()
      const validated = UpdateOpenCodeConfigSchema.parse(body)
      
      const existingConfig = settingsService.getOpenCodeConfigByName(configName, userId)
      const existingAgents = existingConfig?.content?.agent
      
      const config = settingsService.updateOpenCodeConfig(configName, validated, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      if (config.isDefault) {
        const configPath = getOpenCodeConfigFilePath()
        await writeFileContent(configPath, config.rawContent)
        logger.info(`Wrote default config to: ${configPath}`)
        
        const newAgents = config.content?.agent
        const agentsChanged = JSON.stringify(existingAgents) !== JSON.stringify(newAgents)
        
        if (agentsChanged) {
          logger.info('Agent configuration changed, restarting OpenCode server')
          await opencodeServerManager.restart()
        } else {
          const patchResult = await patchOpenCodeConfig(config.content)
          if (!patchResult.success) {
            return c.json({ error: 'Config saved but failed to apply', details: patchResult.error }, 500)
          }
        }
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
      await writeFileContent(configPath, config.rawContent)
      logger.info(`Wrote default config '${configName}' to: ${configPath}`)

      const patchResult = await patchOpenCodeConfig(config.content)
      if (!patchResult.success) {
        return c.json({ error: 'Config saved but failed to apply', details: patchResult.error }, 500)
      }
      
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

  app.post('/opencode-reload', async (c) => {
    try {
      logger.info('OpenCode configuration reload requested')
      await fetch(`http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}/config`, {
        method: 'GET'
      })
      await opencodeServerManager.reloadConfig()
      return c.json({ success: true, message: 'OpenCode configuration reloaded successfully' })
    } catch (error) {
      logger.error('Failed to reload OpenCode config:', error)
      return c.json({
        error: 'Failed to reload OpenCode configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
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

      await writeFileContent(configPath, config.rawContent)
      logger.info(`Rolled back to config '${rollbackConfig}'`)

      opencodeServerManager.clearStartupError()
      try {
        await opencodeServerManager.reloadConfig()
      } catch (reloadError) {
        logger.error('Rollback config reload failed, attempting restart:', reloadError)

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
          details: reloadError instanceof Error ? reloadError.message : 'Unknown error'
        }, 500)
      }

      return c.json({
        success: true,
        message: `Server reloaded with previous working config: ${rollbackConfig}`,
        configName: rollbackConfig
      })
    } catch (error) {
      logger.error('Failed to rollback OpenCode config:', error)
      return c.json({ error: 'Failed to rollback OpenCode config' }, 500)
    }
  })

  app.post('/opencode-upgrade', async (c) => {
    const oldVersion = opencodeServerManager.getVersion()
    logger.info(`Current OpenCode version: ${oldVersion}`)

    try {
      const installMethod = getOpenCodeInstallMethod()
      logger.info(`Running opencode upgrade --method ${installMethod} with 90s timeout...`)
      const { output: upgradeOutput, timedOut } = execWithTimeout(`opencode upgrade --method ${installMethod} 2>&1`, 90000)
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('OpenCode upgrade timed out after 90 seconds')
        throw new Error('Upgrade command timed out after 90 seconds')
      }

      const newVersion = opencodeServerManager.getVersion() || await opencodeServerManager.fetchVersion()
      logger.info(`New OpenCode version: ${newVersion}`)

      const upgraded = oldVersion && newVersion && compareVersions(newVersion, oldVersion) > 0

      if (upgraded) {
        logger.info(`OpenCode upgraded from v${oldVersion} to v${newVersion}`)
        opencodeServerManager.clearStartupError()
        try {
          await opencodeServerManager.reloadConfig()
          logger.info('OpenCode server reloaded after upgrade')
        } catch (reloadError) {
          logger.warn('Config reload after upgrade failed, attempting full restart:', reloadError)
          await opencodeServerManager.restart()
          logger.info('OpenCode server restarted after upgrade')
        }

        return c.json({
          success: true,
          message: `OpenCode upgraded from v${oldVersion} to v${newVersion} and configuration reloaded`,
          oldVersion,
          newVersion,
          upgraded: true
        })
      } else {
        logger.info('OpenCode is already up to date or version unchanged')
        return c.json({
          success: true,
          message: 'OpenCode is already up to date',
          oldVersion,
          newVersion,
          upgraded: false
        })
      }
    } catch (error) {
      logger.error('Failed to upgrade OpenCode:', error)
      logger.warn('Attempting to recover OpenCode server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await opencodeServerManager.restart()
        logger.warn('OpenCode server restarted after upgrade failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover OpenCode server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      let currentVersion: string | null | undefined = oldVersion
      try {
        currentVersion = opencodeServerManager.getVersion() || oldVersion
      } catch (versionError) {
        logger.error('Failed to get version after recovery:', versionError)
        currentVersion = oldVersion
      }

      return c.json(
        recovered ? {
          success: false,
          error: 'Upgrade failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to upgrade OpenCode and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  app.get('/opencode-versions', async (c) => {
    try {
      logger.info('Fetching available OpenCode versions from GitHub')
      
      const response = await fetch('https://api.github.com/repos/sst/opencode/releases?per_page=20', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'opencode-manager'
        }
      })
      
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`)
      }
      
      const releases = await response.json() as Array<{
        tag_name: string
        name: string
        published_at: string
        prerelease: boolean
      }>
      
      const versions = releases
        .filter(r => !r.prerelease)
        .map(r => ({
          version: r.tag_name.replace(/^v/, ''),
          tag: r.tag_name,
          name: r.name,
          publishedAt: r.published_at
        }))
      
      const currentVersion = opencodeServerManager.getVersion()
      
      return c.json({
        versions,
        currentVersion
      })
    } catch (error) {
      logger.error('Failed to fetch OpenCode versions:', error)
      return c.json({
        error: 'Failed to fetch versions',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-install-version', async (c) => {
    const oldVersion = opencodeServerManager.getVersion()
    logger.info(`Current OpenCode version: ${oldVersion}`)

    try {
      const body = await c.req.json()
      const { version } = z.object({ version: z.string().min(1) }).parse(body)

      logger.info(`Installing OpenCode version: ${version}`)
      const versionArg = version.startsWith('v') ? version : `v${version}`
      const installMethod = getOpenCodeInstallMethod()
      logger.info(`Running opencode upgrade ${versionArg} --method ${installMethod} with 90s timeout...`)

      const { output: upgradeOutput, timedOut } = execWithTimeout(`opencode upgrade ${versionArg} --method ${installMethod} 2>&1`, 90000)
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('OpenCode version install timed out after 90 seconds')
        throw new Error('Version install command timed out after 90 seconds')
      }

      const newVersion = await opencodeServerManager.fetchVersion()
      logger.info(`New OpenCode version: ${newVersion}`)

      opencodeServerManager.clearStartupError()
      await opencodeServerManager.restart()
      logger.info('OpenCode server restarted after version change')

      return c.json({
        success: true,
        message: `OpenCode ${oldVersion ? `changed from v${oldVersion} to` : 'installed as'} v${newVersion}`,
        oldVersion,
        newVersion
      })
    } catch (error) {
      logger.error('Failed to install OpenCode version:', error)
      logger.warn('Attempting to recover OpenCode server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await opencodeServerManager.restart()
        logger.warn('OpenCode server restarted after install failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover OpenCode server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      const currentVersion = opencodeServerManager.getVersion() || oldVersion

      return c.json(
        recovered ? {
          success: false,
          error: 'Version install failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to install OpenCode version and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
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

  app.post('/test-ssh', async (c) => {
    try {
      const body = await c.req.json()
      const { host, sshPrivateKey, passphrase } = TestSSHConnectionSchema.parse(body)

      logger.info(`Testing SSH connection to ${host}`)

      const validation = await validateSSHPrivateKey(sshPrivateKey)
      if (!validation.valid) {
        return c.json({
          success: false,
          message: validation.error || 'Invalid SSH key'
        }, 400)
      }

      const { writeTemporarySSHKey, cleanupSSHKey, parseSSHHost } = await import('../utils/ssh-key-manager')

      let keyPath: string | null = null
      try {
        keyPath = await writeTemporarySSHKey(sshPrivateKey, 'test')

        const { user, host: sshHost, port } = parseSSHHost(host)

        const sshArgs = [
          '-T',
          '-i', keyPath,
          '-o', 'IdentitiesOnly=yes',
          '-o', 'PasswordAuthentication=no',
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'UserKnownHostsFile=/dev/null',
        ]

        if (port && port !== '22') {
          sshArgs.push('-p', port)
        }

        sshArgs.push(`${user}@${sshHost}`)

        let executable = 'ssh'
        const env: Record<string, string> = {}
        if (passphrase) {
          executable = 'sshpass'
          sshArgs.unshift('-e', 'ssh')
          env.SSHPASS = passphrase
        }

        const { output, timedOut } = spawnWithTimeout([executable, ...sshArgs], 30000, env)

        if (timedOut) {
          logger.warn(`SSH connection test to ${host} timed out`)
          return c.json({
            success: false,
            message: 'Connection timed out. This may indicate a network issue or an incorrect host.'
          })
        }

        const outputStr = String(output)

        if (outputStr.includes('Permission denied') || outputStr.includes('Access denied')) {
          return c.json({
            success: false,
            message: 'Permission denied. The SSH key may not be authorized on this host, or the passphrase is incorrect.'
          })
        }

        if (outputStr.includes('Could not resolve hostname') || outputStr.includes('Name or service not known')) {
          return c.json({
            success: false,
            message: 'Could not resolve hostname. Please check that the host is correct and accessible.'
          })
        }

        if (outputStr.includes('Connection refused') || outputStr.includes('Connection timed out')) {
          return c.json({
            success: false,
            message: 'Connection refused or timed out. The host may be down or not accepting SSH connections.'
          })
        }

        const authenticated = outputStr.includes('successfully authenticated') ||
                              outputStr.includes('You\'ve successfully authenticated') ||
                              outputStr.includes('Welcome to')

        if (authenticated) {
          logger.info(`SSH connection test to ${host} succeeded`)
          return c.json({
            success: true,
            message: `Successfully connected to ${host}`
          })
        }

        logger.warn(`SSH connection test to ${host} returned ambiguous output: ${outputStr}`)
        return c.json({
          success: false,
          message: `Authentication failed. The key may not be authorized on this host. Details: ${outputStr.trim().substring(0, 200)}`
        })

      } finally {
        if (keyPath) {
          await cleanupSSHKey(keyPath)
        }
      }
    } catch (error) {
      logger.error('Failed to test SSH connection:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to test SSH connection'
      }, 500)
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
      const { directory } = McpAuthDirectorySchema.parse(body)
      
      const response = await proxyToOpenCodeWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/auth/authenticate`,
        'POST',
        directory,
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
