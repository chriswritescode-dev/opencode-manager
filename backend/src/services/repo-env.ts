import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { interpolateEnvExpressions, type EnvExpressionReference } from '@opencode-manager/shared/utils'
import { getRepoByDirectory } from '../db/queries'
import { executeCommand } from '../utils/process'
import { logger } from '../utils/logger'
import { resolveMainCheckoutPath, resolveRepoForDirectory } from './repo'
import type { ProjectConfigService } from './project-config'
import type { SecretsService } from './secrets'

export interface ResolvedRepoEnv {
  env: Record<string, string>
  maskValues: string[]
  missing: string[]
}

function emptyResult(): ResolvedRepoEnv {
  return { env: {}, maskValues: [], missing: [] }
}

export class RepoEnvService {
  constructor(
    private readonly db: Database,
    private readonly projectConfigService: ProjectConfigService,
    private readonly secretsService: SecretsService,
  ) {}

  /**
   * Resolves the repository environment for a directory.
   *
   * Never rejects: any internal failure is logged as a warning naming the directory
   * and resolves to an empty result.
   */
  async resolveForDirectory(cwd: string): Promise<ResolvedRepoEnv> {
    try {
      const topLevel = await this.findTopLevel(cwd)
      if (!topLevel) {
        return emptyResult()
      }

      const repo = await this.findRepo(topLevel)
      if (!repo) {
        return emptyResult()
      }

      const projectRepo = await this.projectConfigService.resolveProjectRepo(repo)
      const repoFile = this.projectConfigService.readRepoFile(topLevel)
      if (!repoFile.file || !this.projectConfigService.isRepoFileTrusted(projectRepo, repoFile)) {
        return emptyResult()
      }

      const mapping = repoFile.file.env
      if (!mapping || Object.keys(mapping).length === 0) {
        return emptyResult()
      }

      const resolved = this.secretsService.resolveValues(projectRepo.id, repoFile.file.environment ?? null)
      const maskValues = new Set<string>()
      const missing = new Set<string>()

      const lookup = (reference: EnvExpressionReference): string | undefined => {
        const values = reference.context === 'secrets' ? resolved.secrets : resolved.vars
        const found = values[reference.name]
        if (found === undefined) {
          missing.add(`${reference.context}.${reference.name}`)
          return undefined
        }
        if (reference.context === 'secrets') {
          maskValues.add(found)
        }
        return found
      }

      const env: Record<string, string> = {}
      for (const [name, template] of Object.entries(mapping)) {
        env[name] = interpolateEnvExpressions(template, lookup).value
      }

      return {
        env,
        maskValues: [...maskValues].filter((value) => value.length >= 4).sort((a, b) => b.length - a.length),
        missing: [...missing],
      }
    } catch (error) {
      logger.warn(`Failed to resolve repository environment for ${cwd}`, error)
      return emptyResult()
    }
  }

  private async findTopLevel(cwd: string): Promise<string | null> {
    try {
      const output = await executeCommand(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { silent: true })
      const topLevel = output.trim()
      return topLevel.length > 0 ? topLevel : null
    } catch {
      return null
    }
  }

  private async findRepo(topLevel: string): Promise<Repo | null> {
    const direct = getRepoByDirectory(this.db, topLevel)
    if (direct) {
      return direct
    }

    const mainCheckout = await resolveMainCheckoutPath(topLevel)
    if (mainCheckout) {
      const mainRepo = getRepoByDirectory(this.db, mainCheckout)
      if (mainRepo) {
        return mainRepo
      }
    }

    return resolveRepoForDirectory(this.db, topLevel)
  }
}
