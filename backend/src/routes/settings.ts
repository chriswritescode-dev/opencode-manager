import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { spawnSync } from 'child_process'
import { randomUUID } from 'crypto'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { writeFileContent, readFileContent, fileExists } from '../services/file-operations'
import { archiveBrokenOpenCodeConfigFile, deleteOpenCodeConfigFile } from '../services/opencode-config-file'
import { reloadOpenCodeOrMarkRestartPending, restoreLastKnownGoodOpenCodeConfig } from '../services/opencode-config-apply'
import { createOpenCodeConfigRoutes } from './opencode-config'
import type { OpenCodeClient } from '../services/opencode/client'
import { getAgentsMdPath } from '@opencode-manager/shared/config/env'
import {
  UserPreferencesSchema,
  type SandboxPreferences,
  type UserPreferences,
} from '../types/settings'
import type { GitCredential } from '@opencode-manager/shared'
import {
  CreateSkillRequestSchema,
  UpdateSkillRequestSchema,
  SkillScopeSchema,
  InstallSkillFromGithubRequestSchema,
  InstallSkillUploadRequestSchema,
} from '@opencode-manager/shared'
import { logger } from '../utils/logger'
import {
  discoverModelsCached,
} from '../utils/discovery-cache'
import { opencodeServerManager, ConfigReloadError } from '../services/opencode-single-server'
import { getOrCreateInternalToken, rotateInternalToken } from '../services/internal-token'
import { sseAggregator } from '../services/sse-aggregator'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import { detectSandboxCapability } from '../services/sandbox/capability'
import { getProcessIdentityAttestationError } from '../services/opencode/process-identity'
import { restartOpenCode, reloadOpenCodeConfig, assertValidOpenCodeConfig, listActiveUserSessions } from '../services/opencode-restart'
import type { GitAuthService } from '../services/git-auth'
import { DEFAULT_AGENTS_MD } from '../constants'
import { validateSSHPrivateKey } from '../utils/ssh-validation'
import { encryptSecret } from '../utils/crypto'
import { getImportedSessionDirectories, getOpenCodeImportStatus, OpenCodeImportProtectionError, syncOpenCodeImport } from '../services/opencode-import'
import { relinkReposFromSessionDirectories } from '../services/repo'
import {
  listManagedSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  installSkillFromGithubTree,
  installSkillFromUploadedFiles,
} from '../services/skills'
import {
  installOpenCodeDirectoryFiles,
  listOpenCodeDirectoryFiles,
  getOpenCodeDirectoryFile,
  updateOpenCodeDirectoryFile,
  deleteOpenCodeDirectoryFile,
} from '../services/opencode-directory-files'
import { parseUploadManifest, readUploadedManifestFiles, UploadValidationError } from './upload-utils'
import { installOpenCodeVersion, latestOpenCodeVersion, listOpenCodeVersions } from '../services/opencode-installer'
import {
  compareOpenCodeVersions,
  describeUnsupportedOpenCodeVersion,
  isStableOpenCodeVersion,
  isSupportedOpenCodeVersion,
  normalizeOpenCodeVersion,
} from '@opencode-manager/shared/opencode'

async function installVerifiedOpenCodeVersion(
  version: string,
  openCodeSupervisor: OpenCodeSupervisor | undefined,
  context: string,
): Promise<string> {
  await installOpenCodeVersion(version)

  const installedVersion = await opencodeServerManager.fetchVersion()
  logger.info(`New OpenCode version: ${installedVersion}`)

  if (installedVersion !== version) {
    throw new Error(`OpenCode install did not result in version ${version}; detected ${installedVersion ?? 'unknown'}`)
  }

  opencodeServerManager.clearStartupError()
  await restartOpenCode(openCodeSupervisor)
  logger.info(`OpenCode server restarted after ${context}`)

  return installedVersion
}

async function reloadOpenCodeForChange(openCodeClient: OpenCodeClient): Promise<{ restartRequired: boolean }> {
  return { restartRequired: await reloadOpenCodeOrMarkRestartPending(openCodeClient) === 'restart_pending' }
}

const OPENCODE_DIRECTORY_UPLOAD_ERROR_STATUS: ReadonlyArray<readonly [string, 400]> = [
  ['No markdown', 400],
  ['Path must be relative', 400],
  ['Path must not contain', 400],
  ['Path must reference', 400],
  ['escapes', 400],
  ['Missing upload file', 400],
  ['not a valid file', 400],
]

function matchErrorStatus<T extends number>(
  table: ReadonlyArray<readonly [string, T]>,
  error: Error,
): T | null {
  const match = table.find(([needle]) => error.message.includes(needle))
  return match ? match[1] : null
}

function handleOpenCodeDirectoryFileError(c: Context, error: unknown, operation: string) {
  logger.error(`Failed to ${operation} OpenCode directory file:`, error)

  if (error instanceof z.ZodError) {
    return c.json({ error: 'Invalid request', details: error.issues }, 400)
  }

  if (error instanceof Error) {
    if ('code' in error && error.code === 'ENOENT') {
      return c.json({ error: 'File not found' }, 404)
    }

    const status = matchErrorStatus(OPENCODE_DIRECTORY_UPLOAD_ERROR_STATUS, error)
    if (status) {
      return c.json({ error: error.message }, status)
    }
  }

  return c.json({ error: `Failed to ${operation} OpenCode directory file` }, 500)
}

const SKILL_INSTALL_ERROR_STATUS: ReadonlyArray<readonly [string, 400 | 404 | 409]> = [
  ['already exists', 409],
  ['404', 404],
  ['Invalid GitHub tree URL', 400],
  ['Invalid skill name', 400],
  ['Only one skill', 400],
  ['Skill source must contain', 400],
  ['Path must be relative', 400],
  ['Path must not contain', 400],
  ['escapes', 400],
  ['no downloadable files', 400],
  ['repoId is required', 400],
  ['Missing upload file', 400],
  ['Invalid repoId', 400],
  ['not a valid file', 400],
]

function sandboxEnforcementChanged(
  previous: SandboxPreferences | undefined,
  next: SandboxPreferences | undefined,
): boolean {
  if (next === undefined) return false
  return (previous?.enabled ?? false) !== next.enabled
}

function preferenceChanged(previous: unknown, next: unknown): boolean {
  return next !== undefined && JSON.stringify(previous) !== JSON.stringify(next)
}

function listOpenCodeRestartReasons(previous: UserPreferences, next: Partial<UserPreferences>): string[] {
  return [
    sandboxEnforcementChanged(previous.sandbox, next.sandbox) && 'sandbox',
    preferenceChanged(previous.gitCredentials ?? [], next.gitCredentials) && 'git credentials',
    preferenceChanged(previous.gitIdentity ?? {}, next.gitIdentity) && 'git identity',
    preferenceChanged(previous.serverEnvVars ?? [], next.serverEnvVars) && 'server environment variables',
    preferenceChanged(previous.disabledDefaultServerEnvVars ?? [], next.disabledDefaultServerEnvVars) && 'default server environment variables',
  ].filter((reason): reason is string => typeof reason === 'string')
}

function markOpenCodeRestartPendingFor(reasons: string[]): boolean {
  if (reasons.length === 0) return false
  logger.info(`${reasons.join(', ')} changed, marking OpenCode server restart as pending`)
  opencodeServerManager.markRestartPending()
  return true
}

function parseOptionalRepoId(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) throw new Error('Invalid repoId')
  return parsed
}

function parseBooleanFormValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function getMarkdownUploadManifest(manifest: ReturnType<typeof parseUploadManifest>) {
  return manifest.filter(entry => entry.relativePath.toLowerCase().endsWith('.md'))
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

const CreateCustomCommandSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})

const UpdateCustomCommandSchema = z.object({
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})



const TestSSHConnectionSchema = z.object({
  host: z.string().min(1),
  sshPrivateKey: z.string().min(1),
  passphrase: z.string().optional(),
})

const SyncOpenCodeImportSchema = z.object({
  overwriteState: z.boolean().optional(),
})


export function createSettingsRoutes(db: Database, gitAuthService: GitAuthService, openCodeClient: OpenCodeClient, openCodeSupervisor?: OpenCodeSupervisor) {
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
                id: cred.id || randomUUID(),
                sshPrivateKeyEncrypted: encryptSecret(cred.sshPrivateKey),
                hasPassphrase: validation.hasPassphrase,
                passphrase: cred.passphrase ? encryptSecret(cred.passphrase) : undefined,
              }
              delete result.sshPrivateKey
              return result
            }
            return { ...cred, id: cred.id || randomUUID() }
          })
        )
        validated.preferences.gitCredentials = validations
        if (validated.preferences.defaultGitCredentialId && !validations.some((cred) => cred.id === validated.preferences.defaultGitCredentialId)) {
          validated.preferences.defaultGitCredentialId = undefined
        }
      }

      const currentSettings = settingsService.getSettings(userId)

      if (currentSettings.preferences.sandbox?.enabled !== true && validated.preferences.sandbox?.enabled === true) {
        const capability = detectSandboxCapability()
        if (capability.available === false) {
          return c.json({ error: `Cannot enable sandboxing: ${capability.reason}` }, 400)
        }
        const attestationError = getProcessIdentityAttestationError()
        if (attestationError !== null) {
          return c.json({ error: `Cannot enable sandboxing: ${attestationError}` }, 400)
        }
      }

      const settings = settingsService.updateSettings(validated.preferences, userId)

      const restartRequired = markOpenCodeRestartPendingFor(
        listOpenCodeRestartReasons(currentSettings.preferences, validated.preferences),
      )

      return c.json(restartRequired ? { ...settings, restartRequired: true } : settings)
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
      const currentSettings = settingsService.getSettings(userId)
      const settings = settingsService.resetSettings(userId)

      const restartRequired = markOpenCodeRestartPendingFor(
        listOpenCodeRestartReasons(currentSettings.preferences, settings.preferences),
      )

      return c.json(restartRequired ? { ...settings, restartRequired: true } : settings)
    } catch (error) {
      logger.error('Failed to reset settings:', error)
      return c.json({ error: 'Failed to reset settings' }, 500)
    }
  })

  // OpenCode Config routes
  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient))

  app.post('/opencode-restart', async (c) => {
    try {
      logger.info('Manual OpenCode server restart requested')
      opencodeServerManager.clearStartupError()
      const { interruptedSessionIDs } = await restartOpenCode(openCodeSupervisor)
      return c.json({
        success: true,
        message: 'OpenCode server restarted successfully',
        interruptedSessions: interruptedSessionIDs,
      })
    } catch (error) {
      logger.error('Failed to restart OpenCode server:', error)
      const startupError = opencodeServerManager.getLastStartupError()
      return c.json({
        error: 'Failed to restart OpenCode server',
        details: startupError || (error instanceof Error ? error.message : 'Unknown error')
      }, 500)
    }
  })

  app.get('/opencode-import/status', async (c) => {
    try {
      return c.json(await getOpenCodeImportStatus())
    } catch (error) {
      logger.error('Failed to get OpenCode import status:', error)
      return c.json({
        error: 'Failed to get OpenCode import status',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-import', async (c) => {
    try {
      const rawBody = c.req.header('content-type')?.includes('application/json') ? await c.req.json() : {}
      const body = SyncOpenCodeImportSchema.parse(rawBody)
      const result = await syncOpenCodeImport({
        overwriteState: body.overwriteState ?? false,
        protectExistingState: true,
        settingsService,
      })

      if (!result.configImported && !result.stateImported) {
        return c.json({
          error: 'No importable OpenCode host data found',
          ...result,
        }, 404)
      }

      let relinkedRepos
      if (result.stateImported) {
        const importedSessions = await getImportedSessionDirectories(result.workspaceStatePath)
        relinkedRepos = await relinkReposFromSessionDirectories(db, gitAuthService, importedSessions.directories)
      } else {
        relinkedRepos = {
          repos: [],
          relinkedCount: 0,
          existingCount: 0,
          nonRepoPathCount: 0,
          duplicatePathCount: 0,
          errors: [],
        }
      }

      opencodeServerManager.clearStartupError()
      await restartOpenCode(openCodeSupervisor)

      return c.json({
        success: true,
        message: 'Imported existing OpenCode host data and restarted the server',
        serverRestarted: true,
        relinkedRepos,
        ...result,
      })
    } catch (error) {
      logger.error('Failed to import existing OpenCode host data:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid OpenCode import request', details: error.issues }, 400)
      }
      if (error instanceof OpenCodeImportProtectionError) {
        return c.json({
          error: error.message,
          code: error.code,
          detail: error.detail,
        }, 409)
      }
      return c.json({
        error: 'Failed to import existing OpenCode host data',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-reload', async (c) => {
    try {
      logger.info('OpenCode configuration reload requested')
      await reloadOpenCodeConfig(openCodeClient)
      return c.json({
        success: true,
        message: 'OpenCode configuration reloaded',
      })
    } catch (error) {
      logger.error('Failed to reload OpenCode config:', error)
      if (error instanceof ConfigReloadError) {
        const details = error.validationIssues.length > 0
          ? error.validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
          : error.message
        return c.json({
          error: error.message,
          details,
          validationIssues: error.validationIssues,
        }, 500)
      }
      return c.json({
        error: 'Failed to reload OpenCode configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/opencode-rollback', async (c) => {
    try {
      logger.info('OpenCode config rollback requested')

      const restored = await restoreLastKnownGoodOpenCodeConfig(settingsService)
      if (!restored) {
        return c.json({ error: 'No previous working config available for rollback' }, 404)
      }

      logger.info('Rolled back to the previous working config')

      try {
        await assertValidOpenCodeConfig()
        await restartOpenCode(openCodeSupervisor)
      } catch (reloadError) {
        logger.error('Rollback config restart failed, attempting restart without the config file:', reloadError)

        await archiveBrokenOpenCodeConfigFile()
        const deleted = await deleteOpenCodeConfigFile()
        if (deleted) {
          logger.info('Deleted filesystem config, attempting restart with fallback')
          await new Promise(r => setTimeout(r, 1000))

          opencodeServerManager.clearStartupError()
          await restartOpenCode(openCodeSupervisor)

          return c.json({
            success: true,
            message: 'Server restarted after deleting the broken config file. The previous working config remains available for rollback.',
            fallback: true,
          })
        }

        return c.json({
          error: 'Failed to rollback and could not delete filesystem config',
          details: reloadError instanceof Error ? reloadError.message : 'Unknown error'
        }, 500)
      }

      return c.json({
        success: true,
        message: 'Server restarted with the previous working config',
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
      const latestVersion = await latestOpenCodeVersion()
      logger.info(`Latest OpenCode version: ${latestVersion}`)

      if (oldVersion && isSupportedOpenCodeVersion(oldVersion) && compareOpenCodeVersions(latestVersion, oldVersion) <= 0) {
        logger.info('OpenCode is already up to date or version unchanged')
        return c.json({
          success: true,
          message: 'OpenCode is already up to date',
          oldVersion,
          newVersion: oldVersion,
          upgraded: false
        })
      }

      logger.info(`Installing OpenCode ${latestVersion} from opencode.ai...`)
      const newVersion = await installVerifiedOpenCodeVersion(latestVersion, openCodeSupervisor, 'upgrade')

      return c.json({
        success: true,
        message: oldVersion
          ? `OpenCode upgraded from v${oldVersion} to v${newVersion} and restarted`
          : `OpenCode v${newVersion} installed and restarted`,
        oldVersion,
        newVersion,
        upgraded: true
      })
    } catch (error) {
      logger.error('Failed to upgrade OpenCode:', error)
      logger.warn('Attempting to recover OpenCode server...')

      let recovered = false
      let recoveryMessage = ''

      opencodeServerManager.clearStartupError()
      try {
        await restartOpenCode(openCodeSupervisor)
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
      logger.info('Fetching available OpenCode versions from the npm registry')

      const releases = await listOpenCodeVersions()

      const versions = releases.map(release => ({
        version: release.version,
        tag: `v${release.version}`,
        name: `v${release.version}`,
        publishedAt: release.publishedAt,
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

    let requestedVersion: string
    try {
      const body = await c.req.json()
      const { version } = z.object({ version: z.string().min(1) }).parse(body)

      requestedVersion = normalizeOpenCodeVersion(version)
      if (!isStableOpenCodeVersion(requestedVersion)) {
        return c.json({ error: 'Invalid version format. Must be in MAJOR.MINOR.PATCH format (e.g., 2.0.15)' }, 400)
      }
      if (!isSupportedOpenCodeVersion(requestedVersion)) {
        return c.json({ error: describeUnsupportedOpenCodeVersion(requestedVersion) }, 400)
      }
    } catch (error) {
      logger.error('Failed to parse OpenCode version install request:', error)
      return c.json({ error: 'Invalid version format. Must be in MAJOR.MINOR.PATCH format (e.g., 2.0.15)' }, 400)
    }

    try {
      logger.info(`Installing OpenCode version: ${requestedVersion}`)
      const newVersion = await installVerifiedOpenCodeVersion(requestedVersion, openCodeSupervisor, 'version change')

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
        await restartOpenCode(openCodeSupervisor)
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
      
      return c.json({ success: true, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      logger.error('Failed to update AGENTS.md:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update AGENTS.md' }, 500)
    }
  })

  app.get('/skills', async (c) => {
    try {
      const repoId = parseOptionalRepoId(c.req.query('repoId'))
      const directory = c.req.query('directory')
      
      const skills = await listManagedSkills(db, openCodeClient, repoId, directory)
      return c.json(skills)
    } catch (error) {
      logger.error('Failed to list skills:', error)
      return c.json({ error: 'Failed to list skills' }, 500)
    }
  })

  app.post('/opencode-directory-files/install', async (c) => {
    try {
      const contentType = c.req.header('content-type') || ''
      if (!contentType.includes('multipart/form-data')) {
        return c.json({ error: 'Unsupported content type. Use multipart/form-data' }, 400)
      }

      const formData = await c.req.parseBody({ all: true })
      const kind = z.enum(['agents', 'commands']).parse(formData['kind'])

      const manifest = parseUploadManifest(formData['fileManifest'])
      const markdownManifest = getMarkdownUploadManifest(manifest)
      if (markdownManifest.length === 0) {
        return c.json({ error: `No markdown ${kind} files found` }, 400)
      }

      const files = await readUploadedManifestFiles(formData, markdownManifest)

      const result = await installOpenCodeDirectoryFiles(kind, files)

      return c.json({ ...result, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      logger.error('Failed to install OpenCode directory files:', error)

      if (error instanceof UploadValidationError) {
        return c.json({ error: error.message }, 400)
      }

      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid upload data', details: error.issues }, 400)
      }

      if (error instanceof Error) {
        const status = matchErrorStatus(OPENCODE_DIRECTORY_UPLOAD_ERROR_STATUS, error)
        if (status) {
          return c.json({ error: error.message }, status)
        }
      }

      return c.json({ error: 'Failed to install OpenCode directory files' }, 500)
    }
  })

  app.get('/opencode-directory-files', async (c) => {
    try {
      const kind = z.enum(['agents', 'commands']).parse(c.req.query('kind'))
      return c.json(await listOpenCodeDirectoryFiles(kind))
    } catch (error) {
      logger.error('Failed to list OpenCode directory files:', error)

      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid file kind', details: error.issues }, 400)
      }

      return c.json({ error: 'Failed to list OpenCode directory files' }, 500)
    }
  })

  app.get('/opencode-directory-files/content', async (c) => {
    try {
      const kind = z.enum(['agents', 'commands']).parse(c.req.query('kind'))
      const relativePath = z.string().min(1).parse(c.req.query('relativePath'))
      return c.json(await getOpenCodeDirectoryFile(kind, relativePath))
    } catch (error) {
      return handleOpenCodeDirectoryFileError(c, error, 'read')
    }
  })

  app.put('/opencode-directory-files', async (c) => {
    try {
      const body = await c.req.json()
      const { kind, relativePath, content } = z
        .object({
          kind: z.enum(['agents', 'commands']),
          relativePath: z.string().min(1),
          content: z.string(),
        })
        .parse(body)

      const result = await updateOpenCodeDirectoryFile(kind, relativePath, content)

      return c.json({ ...result, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      return handleOpenCodeDirectoryFileError(c, error, 'update')
    }
  })

  app.delete('/opencode-directory-files', async (c) => {
    try {
      const kind = z.enum(['agents', 'commands']).parse(c.req.query('kind'))
      const relativePath = z.string().min(1).parse(c.req.query('relativePath'))

      await deleteOpenCodeDirectoryFile(kind, relativePath)

      return c.json({ kind, relativePath, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      return handleOpenCodeDirectoryFileError(c, error, 'delete')
    }
  })

  app.post('/skills/install', async (c) => {
    try {
      const contentType = c.req.header('content-type') || ''

      if (contentType.includes('application/json')) {
        const body = await c.req.json()
        const validated = InstallSkillFromGithubRequestSchema.parse(body)

        if (validated.scope === 'project' && validated.repoId === undefined) {
          return c.json({ error: 'repoId is required for project scope' }, 400)
        }

        const result = await installSkillFromGithubTree(db, validated)

        return c.json({ ...result, ...await reloadOpenCodeForChange(openCodeClient) })
      }

      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.parseBody({ all: true })

        const scope = formData['scope']
        const repoIdValue = formData['repoId']
        const overwriteValue = formData['overwrite']

        const manifest = parseUploadManifest(formData['fileManifest'])

        const repoId = parseOptionalRepoId(repoIdValue as string | undefined)
        const overwrite = parseBooleanFormValue(overwriteValue)

        const uploadRequest = InstallSkillUploadRequestSchema.parse({
          sourceType: 'upload',
          scope,
          repoId,
          overwrite,
        })

        if (scope === 'project' && repoId === undefined) {
          return c.json({ error: 'repoId is required for project scope' }, 400)
        }

        if (manifest.length === 0) {
          return c.json({ error: 'fileManifest must contain at least one entry' }, 400)
        }

        const files = await readUploadedManifestFiles(formData, manifest)

        const result = await installSkillFromUploadedFiles(db, uploadRequest, files)

        return c.json({ ...result, ...await reloadOpenCodeForChange(openCodeClient) })
      }

      return c.json({ error: 'Unsupported content type. Use application/json or multipart/form-data' }, 400)
    } catch (error) {
      logger.error('Failed to install skill:', error)

      if (error instanceof UploadValidationError) {
        return c.json({ error: error.message }, 400)
      }

      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid skill install data', details: error.issues }, 400)
      }

      if (error instanceof Error) {
        const status = matchErrorStatus(SKILL_INSTALL_ERROR_STATUS, error)
        if (status) {
          return c.json({ error: error.message }, status)
        }
      }

      return c.json({ error: 'Failed to install skill' }, 500)
    }
  })

  app.get('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoId = parseOptionalRepoId(c.req.query('repoId'))

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      const skill = await getSkill(db, openCodeClient, name, scope, repoId)
      return c.json(skill)
    } catch (error) {
      logger.error('Failed to get skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid repoId')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to get skill' }, 500)
    }
  })

  app.post('/skills', async (c) => {
    try {
      const body = await c.req.json()
      const validated = CreateSkillRequestSchema.parse(body)

      const skill = await createSkill(db, validated)

      return c.json({ ...skill, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      logger.error('Failed to create skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid skill data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409)
      }
      return c.json({ error: 'Failed to create skill' }, 500)
    }
  })

  app.put('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoId = parseOptionalRepoId(c.req.query('repoId'))
      const body = await c.req.json()
      const validated = UpdateSkillRequestSchema.parse(body)

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      const skill = await updateSkill(db, openCodeClient, name, scope, validated, repoId)

      return c.json({ ...skill, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      logger.error('Failed to update skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid repoId')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to update skill' }, 500)
    }
  })

  app.delete('/skills/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const scope = SkillScopeSchema.parse(c.req.query('scope'))
      const repoId = parseOptionalRepoId(c.req.query('repoId'))

      if (scope === 'project' && !repoId) {
        return c.json({ error: 'repoId is required for project scope' }, 400)
      }

      await deleteSkill(db, name, scope, repoId)

      return c.json({ success: true, ...await reloadOpenCodeForChange(openCodeClient) })
    } catch (error) {
      logger.error('Failed to delete skill:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid scope parameter. Must be "global" or "project"' }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid repoId')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof Error && error.message.includes('Invalid skill name')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to delete skill' }, 500)
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
          '-v',
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
                              outputStr.includes('Welcome to') ||
                              outputStr.includes('Authenticated to')

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

  const OpenCodeServerAuthBodySchema = z.object({
    password: z.union([z.string().min(8), z.null()]),
  })

  app.get('/opencode-server-auth', async (c) => {
    try {
      return c.json({ isSet: true, source: settingsService.getOpenCodeServerPasswordSource() })
    } catch (error) {
      logger.error('Failed to get OpenCode server auth status:', error)
      return c.json({ error: 'Failed to get OpenCode server auth status' }, 500)
    }
  })

  app.patch('/opencode-server-auth', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OpenCodeServerAuthBodySchema.parse(body)
      const previousPasswordState = settingsService.getStoredOpenCodeServerPasswordState()

      if (validated.password === null) {
        settingsService.clearOpenCodeServerPassword()
      } else if (validated.password) {
        settingsService.setOpenCodeServerPassword(validated.password)
      }

      try {
        await restartOpenCode(openCodeSupervisor)
      } catch (restartError) {
        try {
          settingsService.restoreOpenCodeServerPasswordState(previousPasswordState)
          await restartOpenCode(openCodeSupervisor)
          sseAggregator.reconnect()
        } catch (restoreError) {
          logger.error('Failed to restore OpenCode server auth runtime after restart failure:', restoreError)
        }
        throw restartError
      }

      sseAggregator.reconnect()

      return c.json({ isSet: true, source: settingsService.getOpenCodeServerPasswordSource() })
    } catch (error) {
      logger.error('Failed to update OpenCode server auth:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode server auth' }, 500)
    }
  })

  app.get('/manager-token', async (c) => {
    try {
      const token = getOrCreateInternalToken(db)
      return c.json({ token })
    } catch (error) {
      logger.error('Failed to get manager token:', error)
      return c.json({ error: 'Failed to get manager token' }, 500)
    }
  })

  app.post('/manager-token/rotate', async (c) => {
    try {
      const token = rotateInternalToken(db)
      logger.info('Manager token rotated, marking OpenCode server restart as pending')
      opencodeServerManager.markRestartPending()
      return c.json({ token, restartRequired: true })
    } catch (error) {
      logger.error('Failed to rotate manager token:', error)
      return c.json({ error: 'Failed to rotate manager token' }, 500)
    }
  })

  app.get('/opencode-active-sessions', (c) => {
    const sessions = listActiveUserSessions()
    return c.json({ count: sessions.length, sessions })
  })

  app.get('/opencode-discover-models', async (c) => {
    try {
      const baseUrl = c.req.query('baseUrl')
      const apiKey = c.req.query('apiKey') || ''
      const forceRefresh = c.req.query('refresh') === 'true'

      if (!baseUrl || !baseUrl.trim()) {
        return c.json({ error: 'baseUrl is required' }, 400)
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(baseUrl.trim())
      } catch {
        return c.json({ error: 'Invalid baseUrl' }, 400)
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return c.json({ error: 'baseUrl must be an http or https URL' }, 400)
      }

      const trimmedBaseUrl = baseUrl.trim()

      const { models, cached } = await discoverModelsCached({
        baseUrl: trimmedBaseUrl,
        apiKey,
        type: 'opencode-models',
        filterPattern: /.*/,
        defaultModels: [],
        forceRefresh,
      })

      return c.json({ models, cached })
    } catch (error) {
      logger.error('Failed to discover OpenCode models:', error)
      return c.json({ error: 'Failed to discover models' }, 500)
    }
  })

  return app
}
