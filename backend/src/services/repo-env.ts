import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { interpolateEnvExpressions, type EnvExpressionReference } from '@opencode-manager/shared/utils'
import { getRepoByDirectory } from '../db/queries'
import { canonicalPathSync } from '../utils/fs-safe'
import { logger } from '../utils/logger'
import { repoEnvCacheEpoch } from '../utils/repo-env-cache'
import { findGitRepoRoot, resolveRepoForDirectory } from './repo'
import type { ProjectConfigService, RepoFileState } from './project-config'
import type { SecretsService } from './secrets'

const DIRECTORY_CACHE_TTL_MS = 60_000
const DIRECTORY_CACHE_LIMIT = 500
const REPO_FILE_RELATIVE_PATH = path.join('.ocm', 'project.json')

export interface ResolvedRepoEnv {
  env: Record<string, string>
  maskValues: string[]
}

interface DirectoryResolution {
  topLevel: string | null
  repo: Repo | null
  projectRepo: Repo | null
  expiresAt: number
}

interface RepoFileResolution {
  signature: string
  state: RepoFileState
}

function emptyResult(): ResolvedRepoEnv {
  return { env: {}, maskValues: [] }
}

function entrySignature(target: string): string {
  try {
    const stats = fs.lstatSync(target)
    return `${stats.isSymbolicLink() ? 'link' : 'entry'}:${stats.mtimeMs}:${stats.size}`
  } catch {
    return 'missing'
  }
}

function repoFileSignature(filePath: string): string {
  return `${entrySignature(path.dirname(filePath))}|${entrySignature(filePath)}`
}

export class RepoEnvService {
  private readonly directoryCache = new Map<string, DirectoryResolution>()
  private readonly repoFileCache = new Map<string, RepoFileResolution>()
  private cacheEpoch = repoEnvCacheEpoch()

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
      this.syncCacheEpoch()
      const directory = await this.resolveDirectory(cwd)
      if (!directory.topLevel || !directory.repo || !directory.projectRepo) {
        return emptyResult()
      }

      const repoFile = this.readRepoFile(directory.topLevel)
      if (!repoFile.file || !this.projectConfigService.isRepoFileTrusted(directory.projectRepo, repoFile)) {
        return emptyResult()
      }

      const mapping = repoFile.file.env
      if (!mapping || Object.keys(mapping).length === 0) {
        return emptyResult()
      }

      const resolved = this.secretsService.resolveValues(directory.projectRepo.id, repoFile.file.environment ?? null)
      const maskValues = new Set<string>()

      const lookup = (reference: EnvExpressionReference): string | undefined => {
        const values = reference.context === 'secrets' ? resolved.secrets : resolved.vars
        const found = values[reference.name]
        if (found === undefined) {
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
      }
    } catch (error) {
      logger.warn(`Failed to resolve repository environment for ${cwd}`, error)
      return emptyResult()
    }
  }

  private syncCacheEpoch(): void {
    const epoch = repoEnvCacheEpoch()
    if (epoch === this.cacheEpoch) {
      return
    }
    this.cacheEpoch = epoch
    this.directoryCache.clear()
  }

  private async resolveDirectory(cwd: string): Promise<DirectoryResolution> {
    const key = canonicalPathSync(path.resolve(cwd))
    const now = Date.now()
    const cached = this.directoryCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached
    }

    const topLevel = await findGitRepoRoot(cwd)
    const repo = topLevel
      ? getRepoByDirectory(this.db, topLevel) ?? (await resolveRepoForDirectory(this.db, topLevel))
      : null
    const projectRepo = repo ? await this.projectConfigService.resolveProjectRepo(repo) : null

    this.pruneDirectoryCache(now)
    const resolution: DirectoryResolution = {
      topLevel,
      repo,
      projectRepo,
      expiresAt: now + DIRECTORY_CACHE_TTL_MS,
    }
    this.directoryCache.set(key, resolution)
    return resolution
  }

  private pruneDirectoryCache(now: number): void {
    if (this.directoryCache.size < DIRECTORY_CACHE_LIMIT) {
      return
    }
    for (const [key, resolution] of this.directoryCache) {
      if (resolution.expiresAt <= now) {
        this.directoryCache.delete(key)
      }
    }
    for (const key of this.directoryCache.keys()) {
      if (this.directoryCache.size < DIRECTORY_CACHE_LIMIT) {
        break
      }
      this.directoryCache.delete(key)
    }
  }

  private readRepoFile(topLevel: string): RepoFileState {
    const signature = repoFileSignature(path.join(topLevel, REPO_FILE_RELATIVE_PATH))
    const cached = this.repoFileCache.get(topLevel)
    if (cached?.signature === signature) {
      return cached.state
    }

    const state = this.projectConfigService.readRepoFile(topLevel)
    this.repoFileCache.set(topLevel, { signature, state })
    return state
  }
}
