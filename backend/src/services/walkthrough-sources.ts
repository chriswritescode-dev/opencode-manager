import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FileDiffInfo, SessionInfo } from '@opencode-manager/shared/opencode'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'
import { splitUnifiedDiffByFile } from '@opencode-manager/shared/utils'
import { getErrorMessage } from '../utils/error-utils'
import { executeCommand } from '../utils/process'
import { ChangeWalkthroughError } from './change-walkthrough-error'
import type { OpenCodeClient } from './opencode/client'
import { resolveBaseRef, resolveDefaultBranch } from './repo'
import { readSessionChanges } from './session-changes'

export interface ReadWalkthroughChangesOptions {
  client: OpenCodeClient
  session: SessionInfo
  source: WalkthroughSource
  gitEnv?: Record<string, string>
}

type GitWalkthroughSource = Exclude<WalkthroughSource, { kind: 'session' }>

const GIT_DIFF_TIMEOUT_MS = 30_000
const GIT_FETCH_TIMEOUT_MS = 60_000
const GIT_DIFF_MAX_OUTPUT_CHARS = 5_000_000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const DIFF_ARGS = ['--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--no-ext-diff', '--no-textconv', '-U3']
const PULL_REQUEST_REMOTE_PREFERENCE = ['upstream', 'origin']

type PullRequestSource = Extract<GitWalkthroughSource, { kind: 'pullRequest' }>

export interface PullRequestRefs {
  remote: string
  baseBranch: string
  headRef: string
  baseRef: string
}

export interface PullRequestFetchPlan {
  remote: string
  refspecs: string[]
  headRef: string
  baseRef: string
}

export type PullRequestFetchRunner = (
  remote: string,
  refspecs: string[],
  timeoutMs: number,
) => Promise<void>

export async function resolvePullRequestRefs(
  directory: string,
  sessionId: string,
  source: PullRequestSource,
  gitEnv?: Record<string, string>,
): Promise<PullRequestRefs> {
  const remotes = (await tryGit(directory, ['remote'], gitEnv))?.split('\n').map((line) => line.trim()) ?? []
  const remote = PULL_REQUEST_REMOTE_PREFERENCE.find((candidate) => remotes.includes(candidate)) ?? 'origin'
  const baseBranch = source.base ?? await resolveRemoteDefaultBranch(directory, remote, gitEnv)
  return {
    remote,
    baseBranch,
    headRef: `refs/ocm-walkthrough/${sessionId}/pr/${source.number}/head`,
    baseRef: `refs/ocm-walkthrough/${sessionId}/pr/${source.number}/base/${baseBranch}`,
  }
}

export async function planPullRequestFetch(
  directory: string,
  sessionId: string,
  source: PullRequestSource,
  gitEnv?: Record<string, string>,
): Promise<PullRequestFetchPlan> {
  const { remote, baseBranch, headRef, baseRef } = await resolvePullRequestRefs(directory, sessionId, source, gitEnv)
  return {
    remote,
    refspecs: [
      `+refs/pull/${source.number}/head:${headRef}`,
      `+refs/heads/${baseBranch}:${baseRef}`,
    ],
    headRef,
    baseRef,
  }
}

export async function fetchPullRequestRef(
  directory: string,
  sessionId: string,
  source: PullRequestSource,
  gitEnv: Record<string, string> | undefined,
  runFetch: PullRequestFetchRunner,
): Promise<string[]> {
  const plan = await planPullRequestFetch(directory, sessionId, source, gitEnv)
  await mapGitError(
    () => runFetch(plan.remote, plan.refspecs, GIT_FETCH_TIMEOUT_MS),
    'Failed to fetch the pull request',
  )
  return [plan.headRef, plan.baseRef]
}

async function resolveRemoteDefaultBranch(
  directory: string,
  remote: string,
  gitEnv?: Record<string, string>,
): Promise<string> {
  const prefix = `${remote}/`
  const ref = (await tryGit(directory, ['rev-parse', '--abbrev-ref', `${remote}/HEAD`], gitEnv))?.trim()
  if (ref && ref.startsWith(prefix)) {
    return ref.slice(prefix.length)
  }
  return resolveDefaultBranch(directory, gitEnv ?? {})
}

export async function deletePullRequestRef(
  directory: string,
  ref: string,
  gitEnv?: Record<string, string>,
): Promise<void> {
  try {
    await executeCommand(['git', '-C', directory, 'update-ref', '-d', ref], {
      env: gitEnv,
      silent: true,
      ignoreExitCode: true,
      timeout: GIT_DIFF_TIMEOUT_MS,
    })
  } catch {
    return
  }
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
  return readGitChanges(session.location.directory, session.id, source, gitEnv)
}

async function readGitChanges(
  directory: string,
  sessionId: string,
  source: GitWalkthroughSource,
  gitEnv?: Record<string, string>,
): Promise<FileDiffInfo[]> {
  await assertGitRepository(directory, gitEnv)
  const repoRoot = await resolveRepoRoot(directory, gitEnv)

  switch (source.kind) {
    case 'uncommitted':
      return collectChanges(repoRoot, await uncommittedRevision(repoRoot, gitEnv), true, gitEnv)
    case 'staged':
      return collectChanges(repoRoot, ['--cached'], false, gitEnv)
    case 'unstaged':
      return collectChanges(repoRoot, [], true, gitEnv)
    case 'branch': {
      const base = await resolveBase(repoRoot, source.base, gitEnv)
      return collectChanges(repoRoot, [`${base}...HEAD`], false, gitEnv)
    }
    case 'pullRequest': {
      const { headRef, baseRef } = await resolvePullRequestRefs(repoRoot, sessionId, source, gitEnv)
      return collectChanges(repoRoot, [`${baseRef}...${headRef}`], false, gitEnv)
    }
  }
}

async function resolveBase(directory: string, base: string | undefined, gitEnv?: Record<string, string>): Promise<string> {
  const resolved = await resolveBaseRef(
    directory,
    base ?? await resolveDefaultBranch(directory, gitEnv ?? {}),
    gitEnv ?? {},
  )
  if (!resolved) {
    throw new ChangeWalkthroughError('No base branch found', 409, { code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  }
  return resolved
}

async function uncommittedRevision(directory: string, gitEnv?: Record<string, string>): Promise<string[]> {
  return (await headExists(directory, gitEnv)) ? ['HEAD'] : [EMPTY_TREE]
}

async function collectChanges(
  directory: string,
  revisionArgs: string[],
  includeUntracked: boolean,
  gitEnv?: Record<string, string>,
): Promise<FileDiffInfo[]> {
  const tracked = await runDiff(directory, revisionArgs, gitEnv)
  if (!includeUntracked) {
    return splitUnifiedDiffByFile(tracked)
  }
  const untracked = await readUntrackedDiff(directory, gitEnv)
  return splitUnifiedDiffByFile(`${tracked}${untracked}`)
}

async function readUntrackedDiff(directory: string, gitEnv?: Record<string, string>): Promise<string> {
  const untracked = await runGit(directory, ['ls-files', '--others', '--exclude-standard', '-z'], gitEnv)
  if (untracked.length === 0) {
    return ''
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'ocm-walkthrough-index-'))
  const tempIndex = path.join(tempDir, 'index')
  const env = { ...gitEnv, GIT_INDEX_FILE: tempIndex }

  try {
    const indexPath = (await tryGit(directory, ['rev-parse', '--git-path', 'index'], gitEnv))?.trim()
    if (indexPath) {
      const realIndex = path.resolve(directory, indexPath)
      if (existsSync(realIndex)) {
        copyFileSync(realIndex, tempIndex)
      }
    }
    await runGit(directory, ['add', '-N', '-A'], env)
    return await runDiff(directory, ['--diff-filter=A', '--no-renames'], env)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runDiff(directory: string, revisionArgs: string[], gitEnv?: Record<string, string>): Promise<string> {
  const result = await mapGitError(
    () => executeCommand(
      ['git', '-C', directory, 'diff', ...DIFF_ARGS, ...revisionArgs],
      {
        env: gitEnv,
        silent: true,
        ignoreExitCode: true,
        timeout: GIT_DIFF_TIMEOUT_MS,
        maxOutputChars: GIT_DIFF_MAX_OUTPUT_CHARS,
      },
    ),
    'git diff failed',
  )
  if (result.truncated) {
    throw new ChangeWalkthroughError('The diff is too large to display', 413, { code: 'WALKTHROUGH_DIFF_TOO_LARGE' })
  }
  if (result.exitCode !== 0) {
    throw new ChangeWalkthroughError(result.stderr.trim() || 'git diff failed', 502, { code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  }
  return result.stdout
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

async function resolveRepoRoot(directory: string, gitEnv?: Record<string, string>): Promise<string> {
  const root = await tryGit(directory, ['rev-parse', '--show-toplevel'], gitEnv)
  return root ? root.trim() : directory
}

async function headExists(directory: string, gitEnv?: Record<string, string>): Promise<boolean> {
  return (await tryGit(directory, ['rev-parse', '--verify', '--quiet', 'HEAD'], gitEnv)) !== null
}

async function tryGit(directory: string, args: string[], gitEnv?: Record<string, string>): Promise<string | null> {
  const result = await executeCommand(['git', '-C', directory, ...args], {
    env: gitEnv,
    silent: true,
    ignoreExitCode: true,
    timeout: GIT_DIFF_TIMEOUT_MS,
    maxOutputChars: GIT_DIFF_MAX_OUTPUT_CHARS,
  })
  return result.exitCode === 0 ? result.stdout : null
}

async function runGit(
  directory: string,
  args: string[],
  gitEnv?: Record<string, string>,
  timeout = GIT_DIFF_TIMEOUT_MS,
  fallback = 'Git command failed',
): Promise<string> {
  return mapGitError(
    () => executeCommand(['git', '-C', directory, ...args], {
      env: gitEnv,
      silent: true,
      timeout,
      maxOutputChars: GIT_DIFF_MAX_OUTPUT_CHARS,
    }),
    fallback,
  )
}

async function mapGitError<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = getErrorMessage(error)
    if (message.includes('timed out')) {
      throw new ChangeWalkthroughError('git timed out', 504, { code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
    }
    throw new ChangeWalkthroughError(message || fallback, 502, { code: 'WALKTHROUGH_SOURCE_UNAVAILABLE' })
  }
}
