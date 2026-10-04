import path from 'path'
import { existsSync } from 'node:fs'
import type { Database } from 'bun:sqlite'
import { getOpenCodeConfigHome } from '@opencode-manager/shared/config/env'
import type { GitIdentity, RepoGitIdentity } from '@opencode-manager/shared'
import { executeCommand } from '../utils/process'
import { canonicalPathSync, mkdirSyncSafe } from '../utils/fs-safe'
import { logger } from '../utils/logger'
import { createGitIdentityEnv } from '../utils/git-auth'
import { CredentialProvider } from './credential-provider'
import { SettingsService } from './settings'

export interface SyncManagerGitIdentityResult {
  identity: GitIdentity | null
  error: string | null
}

interface GitConfigValue {
  scope: string
  origin: string
  value: string
}

interface ExecuteCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

let managerConfigWriteChain: Promise<unknown> = Promise.resolve()

function serializeManagerConfigWrite<T>(run: () => Promise<T>): Promise<T> {
  const next = managerConfigWriteChain.then(run, run)
  managerConfigWriteChain = next.catch(() => undefined)
  return next
}

export function getManagerGitConfigPath(): string {
  return path.join(getOpenCodeConfigHome(), 'git', 'config')
}

function gitConfigResult(result: string | ExecuteCommandResult): ExecuteCommandResult {
  if (typeof result === 'string') return { exitCode: 0, stdout: result, stderr: '' }
  if (result !== null && typeof result === 'object' && typeof result.exitCode === 'number') return result
  return { exitCode: 1, stdout: '', stderr: '' }
}

function parseGitConfigValue(output: string): GitConfigValue | null {
  const line = output.trim()
  if (!line) return null
  const scopeSeparator = line.indexOf('\t')
  if (scopeSeparator < 0) return null
  const scope = line.slice(0, scopeSeparator)
  const remainder = line.slice(scopeSeparator + 1)
  const originSeparator = remainder.indexOf('\t')
  if (originSeparator < 0) return null
  return {
    scope,
    origin: remainder.slice(0, originSeparator),
    value: remainder.slice(originSeparator + 1),
  }
}

function originFilePath(origin: string): string | null {
  return origin.startsWith('file:') ? origin.slice('file:'.length) : null
}

function isRepositoryScope(scope: string): boolean {
  return scope === 'local' || scope === 'worktree'
}

async function readGitConfigValue(directory: string, key: string): Promise<GitConfigValue | null> {
  const result = gitConfigResult(await executeCommand(
    ['git', '-C', directory, 'config', '--show-scope', '--show-origin', '--get', key],
    { ignoreExitCode: true, silent: true, env: { XDG_CONFIG_HOME: getOpenCodeConfigHome() } },
  ))
  if (result.exitCode !== 0) return null
  return parseGitConfigValue(result.stdout)
}

async function writeManagerConfigValue(key: string, value: string): Promise<void> {
  await executeCommand(['git', 'config', '--file', getManagerGitConfigPath(), key, value])
}

async function unsetManagerConfigValue(key: string): Promise<void> {
  if (!existsSync(getManagerGitConfigPath())) return
  const result = gitConfigResult(await executeCommand(
    ['git', 'config', '--file', getManagerGitConfigPath(), '--unset', key],
    { ignoreExitCode: true, silent: true },
  ))
  if (result.exitCode !== 0 && result.exitCode !== 5) {
    throw new Error(`git config --unset ${key} failed with code ${result.exitCode}: ${result.stderr}`)
  }
}

async function unsetLocalConfigValue(repoPath: string, key: string): Promise<void> {
  const result = gitConfigResult(await executeCommand(
    ['git', '-C', repoPath, 'config', '--local', '--unset', key],
    { ignoreExitCode: true, silent: true },
  ))
  if (result.exitCode !== 0 && result.exitCode !== 5) {
    throw new Error(`git config --local --unset ${key} failed with code ${result.exitCode}: ${result.stderr}`)
  }
}

function findPresetId(database: Database, name: string | null, email: string | null): string | null {
  if (name === null || email === null) return null
  const identities = new SettingsService(database).getSettings('default').preferences.gitIdentities ?? []
  return identities.find((identity) => identity.name === name && identity.email === email)?.id ?? null
}

/**
 * Resolves the Manager default identity and mirrors it into the Manager-owned
 * global git config file so every Manager git command and the OpenCode process
 * resolve the same default. Writes are serialized to avoid git's config lock,
 * and failures are reported rather than thrown so callers can stay best-effort.
 */
export async function syncManagerGitIdentityConfig(database: Database): Promise<SyncManagerGitIdentityResult> {
  let identity: GitIdentity | null = null
  try {
    const resolved = await new CredentialProvider(database).resolveDefaultGitIdentity()
    identity = resolved && (resolved.name || resolved.email) ? resolved : null
    const configured = identity
    await serializeManagerConfigWrite(async () => {
      mkdirSyncSafe(path.dirname(getManagerGitConfigPath()))
      if (configured?.name) {
        await writeManagerConfigValue('user.name', configured.name)
      } else {
        await unsetManagerConfigValue('user.name')
      }
      if (configured) {
        await writeManagerConfigValue('user.email', configured.email)
      } else {
        await unsetManagerConfigValue('user.email')
      }
    })

    if (identity) {
      logger.info(`Manager git identity configured: ${identity.name} <${identity.email}>`)
    } else {
      logger.info('Manager git identity cleared: no default identity configured')
    }

    return { identity, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Failed to sync the Manager git identity config: ${message}`)
    return { identity, error: message }
  }
}

/**
 * Resolves the effective commit identity for a directory using git itself, so a
 * repository-local identity set by the user is respected. Classifies where the
 * values come from and surfaces the matching saved preset when the values are
 * repository-scoped.
 */
export async function getEffectiveGitIdentity(directory: string, database: Database): Promise<RepoGitIdentity> {
  const [nameValue, emailValue] = await Promise.all([
    readGitConfigValue(directory, 'user.name'),
    readGitConfigValue(directory, 'user.email'),
  ])

  const name = nameValue?.value ?? null
  const email = emailValue?.value ?? null
  const values = [nameValue, emailValue].filter((value): value is GitConfigValue => value !== null)
  const managerPath = canonicalPathSync(getManagerGitConfigPath())
  const managerMatch = values.some((value) => {
    const origin = originFilePath(value.origin)
    return origin !== null && canonicalPathSync(origin) === managerPath
  })

  const scope: RepoGitIdentity['scope'] =
    values.some((value) => isRepositoryScope(value.scope)) ? 'repository'
      : managerMatch ? 'default'
        : name !== null || email !== null ? 'global'
          : 'none'

  return {
    name,
    email,
    scope,
    presetId: scope === 'repository' ? findPresetId(database, name, email) : null,
  }
}

export async function setRepoGitIdentity(
  repoPath: string,
  identity: { name: string; email: string } | null,
): Promise<void> {
  if (identity === null) {
    await unsetLocalConfigValue(repoPath, 'user.name')
    await unsetLocalConfigValue(repoPath, 'user.email')
    return
  }

  await executeCommand(['git', '-C', repoPath, 'config', '--local', 'user.name', identity.name])
  await executeCommand(['git', '-C', repoPath, 'config', '--local', 'user.email', identity.email])
}

export async function getGitIdentityEnvForDirectory(
  directory: string,
  database: Database,
): Promise<Record<string, string>> {
  const identity = await getEffectiveGitIdentity(directory, database)
  if (!identity.name) return {}
  return createGitIdentityEnv({ name: identity.name, email: identity.email ?? '' })
}
