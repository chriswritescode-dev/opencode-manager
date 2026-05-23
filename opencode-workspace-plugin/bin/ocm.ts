#!/usr/bin/env bun
import { spawn, spawnSync } from 'child_process'
import { readState, writeState, clearState, getStatePath, type OcmState } from '../src/state.js'
import { getToken, setToken, deleteToken, KeychainError } from '../src/keychain.js'
import { ManagerApi } from '../src/manager-api.js'
import { applyPull, preparePull, PullAbort, type RemoteRepoSummary } from '../src/pull.js'
import { executePush, preparePush, PushAbort } from '../src/push.js'

const USAGE = `ocm - OpenCode Manager workspace launcher

Usage:
  ocm                       Re-attach to the last selected repo
  ocm login <url> [token]   Save manager URL + token (token via stdin if omitted)
  ocm logout                Forget saved token (Keychain) and state
  ocm status                Show current manager URL, repo, and whether token is set
  ocm list                  List ready repos from the manager
  ocm use <repoId|name>     Attach to a specific repo and remember it as last
  ocm pull [--force]        Pull working-tree changes from the matching remote repo into $PWD
                            [--dry-run]
  ocm push [--force]        Push $PWD's working-tree changes to the matching remote repo
                            [--dry-run] [--no-delete]
  ocm --help                Show this help
`

interface ManagerRepo {
  repoId: number
  name: string
  branch: string | null
  cloneStatus: string
  directory: string
  originUrl?: string | null
  extra: { repoId: number; localPath: string; fullPath: string }
}

function die(msg: string, code = 1): never {
  process.stderr.write(`ocm: ${msg}\n`)
  process.exit(code)
}

function info(msg: string): void {
  process.stdout.write(`${msg}\n`)
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
    info('no state. run: ocm login <url>')
    return
  }
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

async function cmdPull(args: string[]): Promise<void> {
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const positional = args.filter((a) => !a.startsWith('--'))
  const force = flags.has('--force')
  const dryRun = flags.has('--dry-run')
  const explicit = positional[0]

  const state = requireState()
  const token = requireToken(state)
  const api = new ManagerApi(state.managerUrl, token)

  const repos = await fetchRepos(state.managerUrl, token)
  let remotes: RemoteRepoSummary[] = repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    originUrl: r.originUrl ?? null,
    directory: r.directory,
  }))

  if (explicit) {
    const filtered = remotes.filter((r) =>
      String(r.repoId) === explicit || r.name === explicit || r.name.toLowerCase() === explicit.toLowerCase(),
    )
    if (filtered.length === 0) die(`no Manager repo matches ${explicit}`)
    remotes = filtered
  }

  let plan
  try {
    plan = await preparePull({ cwd: process.cwd(), remotes, api, force })
  } catch (err) {
    if (err instanceof PullAbort) die(err.message)
    throw err
  }

  info(`remote: ${plan.remoteRepo.name} (repoId=${plan.remoteRepo.repoId}, dir=${plan.remoteRepo.directory})`)
  info(`local:  ${plan.repoRoot}`)
  info(`HEAD:   ${plan.headMatches ? 'aligned' : 'DIVERGED'} (local=${plan.headLocal ?? 'n/a'}, manager=${plan.diff.head ?? 'n/a'})`)
  info(`files:  ${plan.diff.files.length} change(s)`)
  for (const f of plan.diff.files) {
    const tag =
      f.status === 'modified' ? 'M' :
      f.status === 'added' ? 'A' :
      f.status === 'untracked' ? 'U' :
      f.status === 'deleted' ? 'D' :
      f.status === 'renamed' ? 'R' :
      f.status === 'typechange' ? 'T' :
      f.status === 'unmerged' ? '!' : '?'
    info(`  ${tag}  ${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ''}`)
  }
  if (dryRun) {
    info('dry-run: no files written.')
    return
  }
  const result = await applyPull(plan, api)
  info(`applied ${result.applied} change(s)${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}.`)
  if (result.skipped.length > 0) {
    for (const s of result.skipped) info(`  skipped ${s.status}: ${s.path}`)
  }
}

async function cmdPush(args: string[]): Promise<void> {
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const positional = args.filter((a) => !a.startsWith('--'))
  const force = flags.has('--force')
  const dryRun = flags.has('--dry-run')
  const includeDeletions = !flags.has('--no-delete')
  const explicit = positional[0]

  const state = requireState()
  const token = requireToken(state)
  const api = new ManagerApi(state.managerUrl, token)

  const repos = await fetchRepos(state.managerUrl, token)
  let remotes: RemoteRepoSummary[] = repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    originUrl: r.originUrl ?? null,
    directory: r.directory,
  }))

  if (explicit) {
    const filtered = remotes.filter((r) =>
      String(r.repoId) === explicit || r.name === explicit || r.name.toLowerCase() === explicit.toLowerCase(),
    )
    if (filtered.length === 0) die(`no Manager repo matches ${explicit}`)
    remotes = filtered
  }

  let plan
  try {
    plan = preparePush({ cwd: process.cwd(), remotes, api, force, includeDeletions })
  } catch (err) {
    if (err instanceof PushAbort) die(err.message)
    throw err
  }

  info(`remote: ${plan.remoteRepo.name} (repoId=${plan.remoteRepo.repoId}, dir=${plan.remoteRepo.directory})`)
  info(`local:  ${plan.repoRoot}`)
  info(`HEAD:   ${plan.localHead ?? '(none)'}`)
  info(`files:  ${plan.manifest.length} change(s)`)
  for (const f of plan.manifest) {
    const tag =
      f.status === 'modified' ? 'M' :
      f.status === 'added' ? 'A' :
      f.status === 'untracked' ? 'U' :
      f.status === 'deleted' ? 'D' :
      f.status === 'renamed' ? 'R' : '?'
    info(`  ${tag}  ${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ''}`)
  }
  if (plan.skipped.length > 0) {
    info(`skipped ${plan.skipped.length} entr${plan.skipped.length === 1 ? 'y' : 'ies'}:`)
    for (const s of plan.skipped) info(`  ${s.status}: ${s.path}`)
  }
  if (dryRun) {
    info('dry-run: nothing uploaded.')
    return
  }
  if (plan.manifest.length === 0) {
    info('nothing to push.')
    return
  }

  try {
    const result = await executePush(plan, api, { force })
    info(`uploaded ${result.uploaded} file(s); manager applied ${result.applied} change(s).`)
  } catch (err) {
    if (err instanceof PushAbort) die(err.message)
    throw err
  }
}

async function cmdDefault(): Promise<void> {
  const state = requireState()
  if (state.lastRepoId === undefined || !state.lastRepoDir) {
    die('no last repo. run: ocm list  then  ocm use <repoId>')
  }
  const token = requireToken(state)

  const fakeRepo: ManagerRepo = {
    repoId: state.lastRepoId,
    name: state.lastRepoName ?? `repo-${state.lastRepoId}`,
    branch: state.lastRepoBranch ?? null,
    cloneStatus: 'ready',
    directory: state.lastRepoDir,
    extra: { repoId: state.lastRepoId, localPath: '', fullPath: state.lastRepoDir },
  }

  attach(state.managerUrl, token, fakeRepo)
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(USAGE)
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
      case 'pull':
        await cmdPull(rest)
        break
      case 'push':
        await cmdPush(rest)
        break
      default:
        die(`unknown command: ${cmd}. run \`ocm --help\``)
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
}

void main()
