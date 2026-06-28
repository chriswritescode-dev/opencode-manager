import { spawn, spawnSync } from 'child_process'
import { basename } from 'path'
import { readState, writeState, clearState, getStatePath, type OcmState } from '../src/state.js'
import { getToken, setToken, deleteToken, KeychainError } from '../src/keychain.js'
import { ManagerApi, ManagerApiError } from '../src/manager-api.js'
import { mirrorUp, mirrorDown, mirrorUpFast, mirrorDownFast, prepareMirror, MirrorAbort, checkPushDivergence, checkPullDivergence } from '../src/mirror.js'
import type { RemoteRepoSummary, MirrorProgress, PushDivergence, PullDivergence } from '../src/mirror.js'
import { createProgressReporter } from '../src/progress.js'
import { getBranchName, getOriginUrl } from '../src/local-repo.js'
import { resolveOpenCodeProjectId } from '@opencode-manager/shared/project-id'
import { resolveTarget } from '../src/resolve-target.js'
import packageJson from '../package.json' with { type: 'json' }

const VERSION = packageJson.version

const USAGE = `ocm v${VERSION} - OpenCode Manager workspace launcher

Usage:
  ocm                       Attach to the Manager repo matching $PWD's git origin,
                            fall back to the last selected repo, or launch local
                            opencode when no Manager target applies
  ocm login <url> [token]   Save manager URL + token (token via stdin if omitted)
  ocm logout                Forget saved token (Keychain) and state
  ocm status                Show current manager URL, repo, and whether token is set
  ocm list                  List ready repos from the manager
  ocm use <repoId|name>     Attach to a specific repo and remember it as last
  ocm push [--force] [--create] [--yes] [--full]   Mirror $PWD to the matching Manager repo (fast patch sync by default)
  ocm pull [--force] [--full]                      Mirror the matching Manager repo over $PWD (fast patch sync by default)
  ocm --version             Show the installed ocm version
  ocm --help                Show this help
`

interface ManagerRepo {
  repoId: number
  name: string
  branch: string | null
  cloneStatus: string
  directory: string
  projectId?: string | null
  extra: { repoId: number; localPath: string; fullPath: string }
}

function die(msg: string, code = 1): never {
  process.stderr.write(`ocm: ${msg}\n`)
  process.exit(code)
}

function info(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

function promptYesNo(question: string): boolean {
  process.stderr.write(`${question} [y/N] `)
  const res = spawnSync('bash', ['-c', 'read LINE && printf "%s" "$LINE"'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf-8',
  })
  const answer = (res.stdout ?? '').trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
}

function confirmFullFallback(): void {
  if (!process.stdin.isTTY) return
  if (!promptYesNo('Fall back to a full mirror? This replaces the entire server working tree (no merge, no conflict resolution).')) {
    die('aborted')
  }
}

function confirmOverwrite(headline: string, reasons: string[], question: string, note?: string): boolean {
  process.stderr.write(`ocm: warning: ${headline}\n`)
  for (const reason of reasons) process.stderr.write(`  - ${reason}\n`)
  if (note) process.stderr.write(`  ${note}\n`)
  if (!process.stdin.isTTY) {
    die('refusing to discard work; re-run with --force to override')
  }
  if (!promptYesNo(question)) {
    die('aborted')
  }
  return true
}

function guardDivergentPush(repoName: string, div: PushDivergence): boolean {
  const reasons: string[] = []
  if (div.diverged) {
    reasons.push(div.lostCommits >= 0
      ? `the server is ${div.lostCommits} commit(s) ahead of your local branch`
      : 'the server has commit(s) not present in your local branch')
  }
  if (div.serverDirty) reasons.push('the server has uncommitted changes')

  return confirmOverwrite(
    `pushing to ${repoName} will discard server-side work:`,
    reasons,
    'Overwrite server-side work and push anyway?',
    'This work is likely from OpenCode agent sessions on the manager.',
  )
}

function guardDivergentPull(repoName: string, div: PullDivergence): boolean {
  const reasons = [div.lostCommits >= 0
    ? `your local branch is ${div.lostCommits} commit(s) ahead of ${repoName}`
    : `your local branch has commit(s) not present on ${repoName}`]

  return confirmOverwrite(
    `pulling ${repoName} will discard local commits:`,
    reasons,
    'Discard local commits and pull anyway?',
  )
}

function requireState(): OcmState {
  const state = readState()
  if (!state || !state.managerUrl) {
    die(`no manager configured. Run \`ocm login <url>\` first.`)
  }
  return state
}

function requireToken(state: OcmState): string {
  const token = getToken(state.managerUrl)
  if (!token) {
    die(`no token in Keychain for ${state.managerUrl}. Run \`ocm login ${state.managerUrl}\`.`)
  }
  return token
}

async function fetchRepos(managerUrl: string, token: string): Promise<ManagerRepo[]> {
  const res = await fetch(`${managerUrl}/api/internal/opencode-workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`manager responded ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { workspaces: ManagerRepo[] }
  return data.workspaces
}

function attach(managerUrl: string, token: string, repo: ManagerRepo): never {
  const proxyUrl = `${managerUrl}/api/opencode-proxy`
  const args = [
    'attach',
    proxyUrl,
    '--dir', repo.directory,
    '--password', token,
    '--username', 'opencode',
  ]
  const child = spawn('opencode', args, { stdio: 'inherit' })
  child.on('close', (code) => process.exit(code ?? 0))
  child.on('error', (err) => die(`failed to spawn opencode: ${err.message}`))
  // hand control to child
  return undefined as never
}

function findRepo(repos: ManagerRepo[], needle: string | number): ManagerRepo | undefined {
  if (typeof needle === 'number') {
    return repos.find((r) => r.repoId === needle)
  }
  const asNum = Number(needle)
  if (!Number.isNaN(asNum)) {
    const byId = repos.find((r) => r.repoId === asNum)
    if (byId) return byId
  }
  return repos.find((r) => r.name === needle) ?? repos.find((r) => r.name.toLowerCase() === needle.toLowerCase())
}

async function cmdLogin(args: string[]): Promise<void> {
  const url = args[0]
  if (!url) die('usage: ocm login <url> [token]')
  const normalisedUrl = url.replace(/\/+$/, '')

  let token = args[1]
  if (!token) {
    if (process.stdin.isTTY) {
      process.stderr.write('Paste token (input hidden): ')
      const res = spawnSync('bash', ['-c', 'read -s LINE && printf "%s" "$LINE"'], {
        stdio: ['inherit', 'pipe', 'inherit'],
        encoding: 'utf-8',
      })
      process.stderr.write('\n')
      token = (res.stdout ?? '').trim()
    } else {
      token = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = []
        process.stdin.on('data', (c) => chunks.push(c))
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()))
      })
    }
  }
  if (!token) die('no token provided')

  try {
    setToken(normalisedUrl, token)
  } catch (err) {
    if (err instanceof KeychainError) die(`Keychain error: ${err.message}`)
    throw err
  }

  const existing = readState()
  writeState({
    ...existing,
    managerUrl: normalisedUrl,
  })

  info(`Saved token for ${normalisedUrl} in Keychain.`)
  info(`State file: ${getStatePath()}`)
}

async function cmdLogout(): Promise<void> {
  const state = readState()
  if (!state || !state.managerUrl) {
    info('Nothing to log out from.')
    return
  }
  const deleted = deleteToken(state.managerUrl)
  clearState()
  info(deleted ? `Removed Keychain entry for ${state.managerUrl}.` : `No Keychain entry found.`)
  info('State cleared.')
}

async function cmdStatus(): Promise<void> {
  const state = readState()
  if (!state) {
    info(`version:      ${VERSION}`)
    info('no state. run: ocm login <url>')
    return
  }
  info(`version:      ${VERSION}`)
  info(`manager url:  ${state.managerUrl}`)
  info(`token in kc:  ${getToken(state.managerUrl) ? 'yes' : 'no'}`)
  if (state.lastRepoId !== undefined) {
    info(`last repo:    ${state.lastRepoName} (id=${state.lastRepoId}, branch=${state.lastRepoBranch ?? 'n/a'})`)
    info(`last repo dir: ${state.lastRepoDir}`)
  } else {
    info('last repo:    (none)')
  }
  info(`state file:   ${getStatePath()}`)
}

async function cmdList(): Promise<void> {
  const state = requireState()
  const token = requireToken(state)
  const repos = await fetchRepos(state.managerUrl, token)
  if (repos.length === 0) {
    info('No ready repos.')
    return
  }
  const idWidth = Math.max(...repos.map((r) => String(r.repoId).length))
  const nameWidth = Math.max(...repos.map((r) => r.name.length))
  for (const r of repos) {
    const id = String(r.repoId).padStart(idWidth)
    const name = r.name.padEnd(nameWidth)
    const branch = r.branch ? ` (${r.branch})` : ''
    info(`${id}  ${name}  ${r.cloneStatus}${branch}`)
  }
}

async function cmdUse(args: string[]): Promise<void> {
  const needle = args[0]
  if (!needle) die('usage: ocm use <repoId|name>')
  const state = requireState()
  const token = requireToken(state)
  const repos = await fetchRepos(state.managerUrl, token)
  const repo = findRepo(repos, needle)
  if (!repo) die(`repo not found: ${needle}`)

  writeState({
    ...state,
    lastRepoId: repo.repoId,
    lastRepoName: repo.name,
    lastRepoDir: repo.directory,
    lastRepoBranch: repo.branch,
  })

  attach(state.managerUrl, token, repo)
}

async function cmdDefault(): Promise<void> {
  info(`ocm v${VERSION}`)
  const state = requireState()
  const token = requireToken(state)

  const last = state.lastRepoId !== undefined && state.lastRepoDir
    ? {
        repoId: state.lastRepoId,
        name: state.lastRepoName ?? `repo-${state.lastRepoId}`,
        directory: state.lastRepoDir,
        branch: state.lastRepoBranch ?? null,
      }
    : undefined

  const repos = await fetchRepos(state.managerUrl, token)
  const localProjectId = await resolveOpenCodeProjectId(process.cwd())
  const result = resolveTarget({ cwd: process.cwd(), repos, localProjectId, last })

  switch (result.kind) {
    case 'cwd-match': {
      const repo = result.repo
      info(`attaching to ${repo.name} (matched $PWD origin)`)
      writeState({
        ...state,
        lastRepoId: repo.repoId,
        lastRepoName: repo.name,
        lastRepoDir: repo.directory,
        lastRepoBranch: repo.branch,
      })
      attach(state.managerUrl, token, toManagerRepo(repo))
      return
    }
    case 'last':
      attach(state.managerUrl, token, toManagerRepo(result.repo))
      return
    case 'cwd-ambiguous': {
      const names = result.matches.map((r) => `${r.name} (id=${r.repoId})`).join(', ')
      die(`multiple Manager repos match project ${result.localProjectId}: ${names}; disambiguate with \`ocm use <repoId>\``)
      break
    }
    case 'local':
      runLocalOpencode(result.reason)
      return
  }
}

function runLocalOpencode(reason: 'no-match' | 'no-target'): never {
  const message = reason === 'no-match'
    ? 'no Manager repo matches $PWD; launching local opencode'
    : 'no last repo; launching local opencode'
  process.stderr.write(`ocm: ${message}\n`)
  const child = spawn('opencode', [], { stdio: 'inherit' })
  child.on('close', (code) => process.exit(code ?? 0))
  child.on('error', (err) => die(`failed to spawn opencode: ${err.message}`))
  return undefined as never
}

function toManagerRepo(repo: { repoId: number; name: string; branch: string | null; directory: string }): ManagerRepo {
  return {
    repoId: repo.repoId,
    name: repo.name,
    branch: repo.branch,
    cloneStatus: 'ready',
    directory: repo.directory,
    extra: { repoId: repo.repoId, localPath: '', fullPath: repo.directory },
  }
}

export async function cmdPush(args: string[]): Promise<void> {
  let force = false
  let create = false
  let yes = false
  let full = false

  for (const arg of args) {
    if (arg === '--force') force = true
    else if (arg === '--create') create = true
    else if (arg === '--yes') yes = true
    else if (arg === '--full') full = true
  }

  const state = requireState()
  const token = requireToken(state)
  const api = new ManagerApi(state.managerUrl, token)
  const repos = await fetchRepos(state.managerUrl, token)

  const remotes: RemoteRepoSummary[] = repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    projectId: r.projectId ?? null,
    branch: r.branch,
  }))

  const plan = await prepareMirror(process.cwd(), remotes)

  if (plan.matched.length === 0) {
    if (!create) {
      die(`no matching Manager repo for project ${plan.localProjectId}. Re-run with --create to create one.`)
    }

    const name = basename(plan.repoRoot)
    const branch = getBranchName(plan.repoRoot)
    const originUrl = getOriginUrl(plan.repoRoot)

    if (process.stdin.isTTY && !yes) {
      if (!promptYesNo(`Create Manager repo "${name}" by uploading ${plan.repoRoot} (project: ${plan.localProjectId})?`)) {
        die('aborted')
      }
    } else if (!process.stdin.isTTY && !yes) {
      die('stdin is not a TTY; pass --yes to confirm creation')
    }

    const progress = createProgressReporter('push')
    const onProgress = (p: MirrorProgress) => progress.tick(p.bytesSent)
    const result = await mirrorUp(plan, {
      api,
      force,
      create: { name, originUrl, branch },
      onProgress,
    })
    progress.done()
    info(`pushed ${plan.repoRoot} -> ${result.created ? 'created' : 'updated'} (repoId=${result.repoId}, branch=${result.branch})`)
  } else if (plan.matched.length === 1) {
    if (!force) {
      try {
        const divergence = await checkPushDivergence(plan.repoRoot, api, plan.matched[0]!.repoId)
        if (divergence.diverged || divergence.serverDirty) {
          force = guardDivergentPush(plan.matched[0]!.name, divergence)
        }
      } catch (error) {
        if (!(error instanceof ManagerApiError && error.status === 404)) throw error
      }
    }
    if (!full) {
      try {
        const result = await mirrorUpFast(plan, { api, force })
        info(`pushed ${plan.repoRoot} -> ${plan.matched[0]!.name} via bundle (repoId=${result.repoId}, branch=${result.branch})`)
        return
      } catch (error) {
        if (error instanceof MirrorAbort) throw error
        process.stderr.write(`ocm: patch push failed: ${error instanceof Error ? error.message : String(error)}\n`)
        confirmFullFallback()
      }
    }
    const progress = createProgressReporter('push')
    const onProgress = (p: MirrorProgress) => progress.tick(p.bytesSent)
    const result = await mirrorUp(plan, { api, force, onProgress })
    progress.done()
    info(`pushed ${plan.repoRoot} -> ${plan.matched[0]!.name} (repoId=${result.repoId}, branch=${result.branch})`)
  } else {
    const names = plan.matched.map((r) => `${r.name} (id=${r.repoId})`).join(', ')
    die(`multiple Manager repos match project ${plan.localProjectId}: ${names}; disambiguate with \`ocm push <repoId>\``)
  }
}

async function cmdPull(args: string[]): Promise<void> {
  let force = false
  let full = false

  for (const arg of args) {
    if (arg === '--force') force = true
    else if (arg === '--full') full = true
  }

  const state = requireState()
  const token = requireToken(state)
  const api = new ManagerApi(state.managerUrl, token)
  const repos = await fetchRepos(state.managerUrl, token)

  const remotes: RemoteRepoSummary[] = repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    projectId: r.projectId ?? null,
    branch: r.branch,
  }))

  const plan = await prepareMirror(process.cwd(), remotes)

  if (plan.matched.length === 0) {
    die(`no matching Manager repo for project ${plan.localProjectId}.`)
  }

  if (plan.matched.length > 1) {
    const names = plan.matched.map((r) => `${r.name} (id=${r.repoId})`).join(', ')
    die(`multiple Manager repos match project ${plan.localProjectId}: ${names}; disambiguate with \`ocm pull <repoId>\``)
  }

  if (!force) {
    try {
      const divergence = await checkPullDivergence(plan.repoRoot, api, plan.matched[0]!.repoId)
      if (divergence.diverged) {
        force = guardDivergentPull(plan.matched[0]!.name, divergence)
      }
    } catch (error) {
      if (!(error instanceof ManagerApiError && error.status === 404)) throw error
    }
  }

  if (!full) {
    try {
      await mirrorDownFast(plan.matched[0]!.repoId, plan.repoRoot, api, { force })
      info(`pulled ${plan.matched[0]!.name} -> ${plan.repoRoot} via bundle`)
      return
    } catch (error) {
      if (error instanceof MirrorAbort && !error.message.includes('falling back')) throw error
      process.stderr.write(`ocm: patch pull failed: ${error instanceof Error ? error.message : String(error)}\n`)
      confirmFullFallback()
    }
  }
  const progress = createProgressReporter('pull')
  try {
    await mirrorDown(plan.matched[0]!.repoId, plan.repoRoot, api, { force, onProgress: (bytes) => progress.tick(bytes) })
  } finally {
    progress.done()
  }
  info(`pulled ${plan.matched[0]!.name} -> ${plan.repoRoot}`)
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(USAGE)
    return
  }

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    info(VERSION)
    return
  }

  try {
    switch (cmd) {
      case undefined:
        await cmdDefault()
        break
      case 'login':
        await cmdLogin(rest)
        break
      case 'logout':
        await cmdLogout()
        break
      case 'status':
        await cmdStatus()
        break
      case 'list':
      case 'ls':
        await cmdList()
        break
      case 'use':
      case 'attach':
        await cmdUse(rest)
        break
      case 'push':
        await cmdPush(rest)
        break
      case 'pull':
        await cmdPull(rest)
        break
      default:
        die(`unknown command: ${cmd}. run \`ocm --help\``)
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
}

// Only run main when executed directly (not imported by tests).
const entryUrl = process.argv[1] ? `file://${process.argv[1]}` : ''
if (entryUrl === import.meta.url || process.argv[1]?.endsWith('/ocm.js') || process.argv[1]?.endsWith('/ocm')) {
  void main()
}
