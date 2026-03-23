import type { Database } from 'bun:sqlite'
import type { DevcontainerConfig, DevcontainerTemplate } from '@opencode-manager/shared'
import * as db from '../db/queries'
import { logger } from '../utils/logger'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'
import { execCommand } from '../utils/process'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const BUILT_IN_TEMPLATES_PATH = path.join(__dirname, '../templates/devcontainers')
const WORKSPACE_BASE = getWorkspacePath()
const DEVCONTAINERS_PATH = path.join(WORKSPACE_BASE, 'devcontainers')

export class DevcontainerManager {
  private db: Database

  constructor(database: Database) {
    this.db = database
  }

  async initialize(): Promise<void> {
    await this.ensureDevcontainersRepo()
    await this.loadBuiltInTemplates()
  }

  private async ensureDevcontainersRepo(): Promise<void> {
    try {
      await mkdir(DEVCONTAINERS_PATH, { recursive: true })
      
      const isGitRepo = await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'rev-parse', '--git-dir'])
        .then(() => true)
        .catch(() => false)

      if (!isGitRepo) {
        logger.info('Initializing devcontainers git repository')
        await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'init'])
        await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'config', 'user.name', 'OpenCode Manager'])
        await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'config', 'user.email', 'manager@opencode.local'])
        
        const readmePath = path.join(DEVCONTAINERS_PATH, 'README.md')
        await writeFile(readmePath, `# Devcontainer Templates

This directory contains devcontainer templates for OpenCode Manager sessions.

## Built-in Templates

- **minimal** - Git only
- **nodejs** - Node.js with npm
- **nodejs-fullstack** - Node.js + PostgreSQL + Redis
- **python** - Python with pip
- **rust** - Rust with cargo

## Custom Templates

You can create custom templates by:
1. Creating a new directory
2. Adding a \`devcontainer.json\` file
3. Optionally adding a custom \`Dockerfile.nix\`

Templates are automatically version-controlled with git.
`, 'utf-8')

        await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'add', 'README.md'])
        await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'commit', '-m', 'Initial commit: Add README'])
        logger.info('Devcontainers git repository initialized')
      }
    } catch (error) {
      logger.error('Failed to initialize devcontainers repository:', error)
      throw error
    }
  }

  private async loadBuiltInTemplates(): Promise<void> {
    const builtInTemplates = ['minimal', 'nodejs', 'nodejs-fullstack', 'python', 'rust']

    for (const templateName of builtInTemplates) {
      try {
        const existing = db.getDevcontainerTemplate(this.db, templateName)

        const configPath = path.join(BUILT_IN_TEMPLATES_PATH, `${templateName}.json`)
        const configContent = await readFile(configPath, 'utf-8')
        const config = JSON.parse(configContent) as DevcontainerConfig

        const template: DevcontainerTemplate = {
          name: templateName,
          config,
          isBuiltIn: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: config.metadata,
        }

        if (existing) {
          const existingConfig = JSON.stringify(existing.config)
          const nextConfig = JSON.stringify(config)
          if (existingConfig !== nextConfig || !existing.isBuiltIn) {
            db.updateDevcontainerTemplate(this.db, templateName, config)
            logger.info(`Updated built-in template: ${templateName}`)
          } else {
            logger.info(`Built-in template unchanged: ${templateName}`)
          }
        } else {
          db.createDevcontainerTemplate(this.db, template)
          logger.info(`Loaded built-in template: ${templateName}`)
        }

        await this.writeTemplateToRepo(templateName, config)
      } catch (error) {
        logger.error(`Failed to load built-in template ${templateName}:`, error)
      }
    }
  }

  private async writeTemplateToRepo(templateName: string, config: DevcontainerConfig): Promise<void> {
    const templateDir = path.join(DEVCONTAINERS_PATH, templateName)
    await mkdir(templateDir, { recursive: true })

    const configPath = path.join(templateDir, 'devcontainer.json')
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')

    const dockerfilePath = path.join(BUILT_IN_TEMPLATES_PATH, 'Dockerfile.nix')
    const dockerfileContent = await readFile(dockerfilePath, 'utf-8')
    await writeFile(path.join(templateDir, 'Dockerfile.nix'), dockerfileContent, 'utf-8')

    try {
      await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'add', templateName])
      const status = await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'status', '--porcelain', templateName])
      
      if (status.trim()) {
        await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'commit', '-m', `Add/update template: ${templateName}`])
      }
    } catch (error) {
      logger.warn(`Failed to commit template ${templateName}:`, error)
    }
  }

  calculateConfigHash(config: DevcontainerConfig): string {
    const normalized = {
      name: config.name,
      build: {
        args: Object.keys(config.build.args).sort().reduce((acc, key) => {
          acc[key] = config.build.args[key]
          return acc
        }, {} as Record<string, string>)
      },
      containerEnv: config.containerEnv ? Object.keys(config.containerEnv).sort().reduce((acc, key) => {
        acc[key] = config.containerEnv![key]
        return acc
      }, {} as Record<string, string>) : {},
    }

    const hash = createHash('sha256')
    hash.update(JSON.stringify(normalized))
    return hash.digest('hex').substring(0, 16)
  }

  async getTemplate(name: string): Promise<DevcontainerTemplate | null> {
    return db.getDevcontainerTemplate(this.db, name)
  }

  async listTemplates(): Promise<DevcontainerTemplate[]> {
    return db.getAllDevcontainerTemplates(this.db)
  }

  async createTemplate(name: string, config: DevcontainerConfig, basedOn?: string): Promise<DevcontainerTemplate> {
    const existing = db.getDevcontainerTemplate(this.db, name)
    if (existing) {
      throw new Error(`Template with name '${name}' already exists`)
    }

    let finalConfig = config
    if (basedOn) {
      const baseTemplate = await this.getTemplate(basedOn)
      if (!baseTemplate) {
        throw new Error(`Base template '${basedOn}' not found`)
      }
      finalConfig = this.mergeConfigs(baseTemplate.config, config)
    }

    const template: DevcontainerTemplate = {
      name,
      config: finalConfig,
      forkedFrom: basedOn,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    db.createDevcontainerTemplate(this.db, template)
    await this.writeTemplateToRepo(name, finalConfig)

    logger.info(`Created template: ${name}${basedOn ? ` (based on ${basedOn})` : ''}`)
    return template
  }

  async updateTemplate(name: string, config: DevcontainerConfig): Promise<void> {
    const template = await this.getTemplate(name)
    if (!template) {
      throw new Error(`Template '${name}' not found`)
    }

    if (template.isBuiltIn) {
      throw new Error(`Cannot modify built-in template '${name}'. Fork it first.`)
    }

    db.updateDevcontainerTemplate(this.db, name, config)
    await this.writeTemplateToRepo(name, config)

    const affectedSessions = db.getSessionsByTemplate(this.db, name)
    for (const session of affectedSessions) {
      db.updateSessionStatus(this.db, session.id, 'stale')
    }

    logger.info(`Updated template: ${name}, ${affectedSessions.length} sessions marked as stale`)
  }

  async forkTemplate(originalName: string, newName: string): Promise<DevcontainerTemplate> {
    const original = await this.getTemplate(originalName)
    if (!original) {
      throw new Error(`Template '${originalName}' not found`)
    }

    return await this.createTemplate(newName, { ...original.config, name: newName }, originalName)
  }

  async deleteTemplate(name: string): Promise<void> {
    const template = await this.getTemplate(name)
    if (!template) {
      throw new Error(`Template '${name}' not found`)
    }

    if (template.isBuiltIn) {
      throw new Error(`Cannot delete built-in template '${name}'`)
    }

    const sessions = db.getSessionsByTemplate(this.db, name)
    if (sessions.length > 0) {
      throw new Error(`Cannot delete template '${name}': ${sessions.length} sessions are using it`)
    }

    db.deleteDevcontainerTemplate(this.db, name)

    try {
      await execCommand(['rm', '-rf', path.join(DEVCONTAINERS_PATH, name)])
      await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'add', '.'])
      await execCommand(['git', '-C', DEVCONTAINERS_PATH, 'commit', '-m', `Remove template: ${name}`])
    } catch (error) {
      logger.warn(`Failed to remove template directory ${name}:`, error)
    }

    logger.info(`Deleted template: ${name}`)
  }

  private mergeConfigs(base: DevcontainerConfig, override: Partial<DevcontainerConfig>): DevcontainerConfig {
    const merged: DevcontainerConfig = {
      ...base,
      ...override,
      build: {
        ...base.build,
        ...override.build,
        args: {
          ...base.build.args,
          ...override.build?.args,
        },
      },
      containerEnv: {
        ...base.containerEnv,
        ...override.containerEnv,
      },
    }

    if (base.customizations?.vscode && override.customizations?.vscode) {
      merged.customizations = {
        vscode: {
          extensions: [
            ...(base.customizations.vscode.extensions || []),
            ...(override.customizations.vscode.extensions || []),
          ],
          settings: {
            ...base.customizations.vscode.settings,
            ...override.customizations.vscode.settings,
          },
        },
      }
    }

    return merged
  }
}
