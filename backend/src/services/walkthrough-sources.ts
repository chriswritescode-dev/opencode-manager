import type { FileDiffInfo, SessionInfo } from '@opencode-manager/shared/opencode'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'
import { splitUnifiedDiffByFile } from '@opencode-manager/shared/utils'
import { getErrorMessage } from '../utils/error-utils'
import { executeCommand } from '../utils/process'
import { ChangeWalkthroughError } from './change-walkthrough-error'
import type { OpenCodeClient } from './opencode/client'
import { readSessionChanges } from './session-changes'

export interface ReadWalkthroughChangesOptions {
  client: OpenCodeClient
  session: SessionInfo
  source: WalkthroughSource
  gitEnv?: Record<string, string>
}

type GitWalkthroughSource = Exclude<WalkthroughSource, { kind: 'session' }>

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function commandResult(result: string | CommandResult): CommandResult {
  return typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result
}

export async function readWalkthroughChanges({
  client,
  session,
  source,
  gitEnv,
}: ReadWalkthroughChangesOptions): Promise<FileDiffInfo[]> {
  if (source.kind === 'session') {
    return readSessionChanges(client, session.id)
  }
  return readGitChanges(session.location.directory, source, gitEnv)
}

async function readGitChanges(
  directory: string,
  source: GitWalkthroughSource,
  gitEnv?: Record<string, string>,
): Promise<FileDiffInfo[]> {
  await assertGitRepository(directory, gitEnv)

  switch (source.kind) {
    case 'uncommitted':
      return collectChanges(directory, await uncommittedRevision(directory, gitEnv), true, gitEnv)
    case 'staged':
      return collectChanges(directory, ['--cached'], false, gitEnv)
    case 'unstaged':
      return collectChanges(directory, await unstagedRevision(directory, gitEnv), true, gitEnv)
    case 'branch': {
      const base = await resolveBaseBranch(directory, source.base, gitEnv)
      return collectChanges(directory, [`${base}...HEAD`], false, gitEnv)
    }
    case 'pullRequest': {
      const base = await resolveBaseBranch(directory, source.base, gitEnv)
      const ref = `refs/ocm-walkthrough/pr/${source.number}`
      try {
        await runGit(directory, ['fetch', '--no-tags', 'origin', `+refs/pull/${source.number}/head:${ref}`], gitEnv)
      } catch (error) {
        throw new ChangeWalkthroughError(getErrorMessage(error) || 'Failed to fetch the pull request', 502, {
          code: 'WALKTHROUGH_SOURCE_UNAVAILABLE',
        })
      }
      return collectChanges(directory, [`${base}...${ref}`], false, gitEnv)
    }
  }
}

async function uncommittedRevision(directory: string, gitEnv?: Record<string, string>): Promise<string[]> {
  return (await headExists(directory, gitEnv)) ? ['HEAD'] : ['--cached']
}

async function unstagedRevision(directory: string, gitEnv?: Record<string, string>): Promise<string[]> {
  return (await headExists(directory, gitEnv)) ? [] : ['--cached']
}

async function collectChanges(
  directory: string,
  revisionArgs: string[],
  includeUntracked: boolean,
  gitEnv?: Record<string, string>,
): Promise<FileDiffInfo[]> {
  const tracked = await runGit(directory, ['diff', '--no-color', '--no-ext-diff', '-U3', ...revisionArgs], gitEnv)
  if (!includeUntracked) {
    return splitUnifiedDiffByFile(tracked)
  }
  const untracked = await readUntrackedDiffs(directory, gitEnv)
  return splitUnifiedDiffByFile([tracked, ...untracked].join(''))
}

async function readUntrackedDiffs(directory: string, gitEnv?: Record<string, string>): Promise<string[]> {
  const output = await runGit(directory, ['ls-files', '--others', '--exclude-standard', '-z'], gitEnv)
  const paths = output.split('\0').filter((entry) => entry.length > 0).sort()
  const diffs: string[] = []
  for (const filePath of paths) {
    const result = commandResult(await executeCommand(
      ['git', '-C', directory, 'diff', '--no-color', '--no-index', '--', '/dev/null', filePath],
      { env: gitEnv, silent: true, ignoreExitCode: true },
    ))
    diffs.push(result.stdout)
  }
  return diffs
}

async function assertGitRepository(directory: string, gitEnv?: Record<string, string>): Promise<void> {
  let insideWorkTree = false
  try {
    insideWorkTree = (await runGit(directory, ['rev-parse', '--is-inside-work-tree'], gitEnv)).trim() === 'true'
  } catch {
    insideWorkTree = false
  }
  if (!insideWorkTree) {
    throw new ChangeWalkthroughError('Not a git repository', 409, { code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  }
}

async function headExists(directory: string, gitEnv?: Record<string, string>): Promise<boolean> {
  const result = commandResult(await executeCommand(
    ['git', '-C', directory, 'rev-parse', '--verify', '--quiet', 'HEAD'],
    { env: gitEnv, silent: true, ignoreExitCode: true },
  ))
  return result.exitCode === 0
}

async function resolveBaseBranch(
  directory: string,
  base: string | undefined,
  gitEnv?: Record<string, string>,
): Promise<string> {
  if (base) {
    return base
  }

  const originHead = await tryGit(directory, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], gitEnv)
  if (originHead) {
    return originHead.trim()
  }

  for (const candidate of ['main', 'master']) {
    const resolved = await tryGit(directory, ['rev-parse', '--verify', '--quiet', candidate], gitEnv)
    if (resolved) {
      return candidate
    }
  }

  throw new ChangeWalkthroughError('No base branch found', 409, { code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
}

async function tryGit(directory: string, args: string[], gitEnv?: Record<string, string>): Promise<string | null> {
  const result = commandResult(await executeCommand(['git', '-C', directory, ...args], {
    env: gitEnv,
    silent: true,
    ignoreExitCode: true,
  }))
  return result.exitCode === 0 ? result.stdout : null
}

async function runGit(directory: string, args: string[], gitEnv?: Record<string, string>): Promise<string> {
  return executeCommand(['git', '-C', directory, ...args], { env: gitEnv, silent: true })
}
