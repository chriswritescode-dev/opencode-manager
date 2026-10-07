import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, spawnSync } from 'child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { repoRoot } from '../helpers/repo-root'
import { extractShellFunction } from '../helpers/shell-function'

const installerPath = join(repoRoot, 'scripts/install.sh')
const STUB_COMPOSE = 'services:\n  app:\n    image: stub\n'

let workDir: string
let stubDir: string
let installDir: string
let logPath: string

const writeStub = (name: string, body: string) => {
  const file = join(stubDir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
}

const stubCalls = () => (existsSync(logPath) ? readFileSync(logPath, 'utf-8').split('\n').filter(Boolean) : [])

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ocm-install-'))
  stubDir = join(workDir, 'bin')
  installDir = join(workDir, 'opencode-manager')
  logPath = join(workDir, 'calls.log')
  mkdirSync(stubDir)

  writeStub('docker', `echo "$(pwd) docker $*" >> "$OCM_STUB_LOG"
if [ "$1" = info ]; then exit "\${OCM_STUB_DOCKER_INFO_EXIT:-0}"; fi
if [ "$1" = inspect ]; then
  [ -n "\${OCM_STUB_CONTAINER+x}" ] || exit 1
  case "$*" in
    *project.working_dir*) echo "\${OCM_STUB_CONTAINER_DIR:-}" ;;
    *com.docker.compose.project*) echo "\${OCM_STUB_CONTAINER_PROJECT:-}" ;;
  esac
  exit 0
fi
exit 0`)
  writeStub('curl', `echo "curl $*" >> "$OCM_STUB_LOG"
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; fi
  shift
done
if [ -n "$out" ] && [ "$out" != /dev/null ]; then printf '%s' "$OCM_STUB_COMPOSE" > "$out"; fi
exit 0`)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const runInstaller = (
  env: Record<string, string> = {},
  path = `${stubDir}:/usr/bin:/bin`,
) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('/bin/sh', [installerPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: path,
        HOME: workDir,
        OCM_DIR: installDir,
        OCM_STUB_LOG: logPath,
        OCM_STUB_COMPOSE: STUB_COMPOSE,
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })

describe('install.sh', () => {
  it('installs with defaults and shares no host folders when no terminal is available', async () => {
    const res = await runInstaller({ OCM_REF: 'beta' })

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain('No terminal available')
    expect(readFileSync(join(installDir, 'docker-compose.yml'), 'utf-8')).toBe(STUB_COMPOSE)
    expect(existsSync(join(installDir, '.env'))).toBe(false)
    expect(existsSync(join(installDir, 'docker-compose.override.yml'))).toBe(false)

    const calls = stubCalls()
    expect(calls).toContain(
      `curl -fsSL https://raw.githubusercontent.com/chriswritescode-dev/opencode-manager/beta/docker-compose.release.yml -o ${installDir}/docker-compose.yml.download`,
    )
    const pullIndex = calls.indexOf(`${installDir} docker compose pull`)
    const upIndex = calls.indexOf(`${installDir} docker compose up -d`)
    expect(pullIndex).toBeGreaterThan(-1)
    expect(upIndex).toBeGreaterThan(pullIndex)
    expect(calls.some((call) => call.includes('http://localhost:5003/api/health'))).toBe(true)
    expect(res.stdout).toContain('OpenCode Manager is running.')
  })

  it('updates an existing install without prompting or touching its settings', async () => {
    mkdirSync(installDir)
    writeFileSync(join(installDir, 'docker-compose.yml'), 'old')
    writeFileSync(join(installDir, '.env'), "OCM_REPOS_HOST_PATH='/srv/repos'\n")

    const res = await runInstaller()

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain(`Updating OpenCode Manager in ${installDir}`)
    expect(res.stdout).not.toContain('No terminal available')
    expect(readFileSync(join(installDir, 'docker-compose.yml'), 'utf-8')).toBe(STUB_COMPOSE)
    expect(readFileSync(join(installDir, '.env'), 'utf-8')).toBe("OCM_REPOS_HOST_PATH='/srv/repos'\n")
    expect(stubCalls()).toContain(`${installDir} docker compose up -d`)
  })

  it('updates the container it installed earlier', async () => {
    mkdirSync(installDir)
    writeFileSync(join(installDir, 'docker-compose.yml'), 'old')

    const res = await runInstaller({ OCM_STUB_CONTAINER: '1', OCM_STUB_CONTAINER_PROJECT: 'ocm' })

    expect(res.status, res.stderr).toBe(0)
    expect(stubCalls()).toContain(`${installDir} docker compose up -d`)
  })

  it('refuses to install over a source checkout', async () => {
    mkdirSync(join(installDir, '.git'), { recursive: true })
    writeFileSync(join(installDir, 'docker-compose.yml'), 'tracked')

    const res = await runInstaller()

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('is a source checkout of OpenCode Manager')
    expect(readFileSync(join(installDir, 'docker-compose.yml'), 'utf-8')).toBe('tracked')
    expect(stubCalls().some((call) => call.startsWith('curl '))).toBe(false)
  })

  it('refuses to start next to an install from a source checkout and names where it runs', async () => {
    const res = await runInstaller({
      OCM_STUB_CONTAINER: '1',
      OCM_STUB_CONTAINER_PROJECT: 'opencode-manager',
      OCM_STUB_CONTAINER_DIR: '/home/me/src/opencode-manager',
    })

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('already installed from /home/me/src/opencode-manager')
    expect(existsSync(installDir)).toBe(false)
    expect(stubCalls().some((call) => call.includes('compose pull'))).toBe(false)
  })

  it('refuses to start next to a container named opencode-manager that Compose does not manage', async () => {
    const res = await runInstaller({ OCM_STUB_CONTAINER: '1', OCM_STUB_CONTAINER_PROJECT: '' })

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('already exists outside Docker Compose')
    expect(existsSync(installDir)).toBe(false)
  })

  it('stops before downloading anything when Docker is missing', async () => {
    const isolatedBin = join(workDir, 'isolated-bin')
    mkdirSync(isolatedBin)
    copyFileSync(join(stubDir, 'curl'), join(isolatedBin, 'curl'))

    const res = await runInstaller({}, isolatedBin)

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Docker is required')
    expect(stubCalls()).toEqual([])
    expect(existsSync(installDir)).toBe(false)
  })

  it('explains an unreachable Docker daemon', async () => {
    const res = await runInstaller({ OCM_STUB_DOCKER_INFO_EXIT: '1' })

    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Docker is installed but not reachable')
    expect(stubCalls().some((call) => call.startsWith('curl '))).toBe(false)
  })
})

describe('install.sh helpers', () => {
  const runHelper = (functions: string[], snippet: string) =>
    spawnSync('sh', ['-c', `set -eu\n${functions.map((name) => extractShellFunction(installerPath, name)).join('\n')}\n${snippet}`], {
      encoding: 'utf-8',
      cwd: workDir,
    })

  it('writes an override that imports OpenCode read-only and shares the repositories folder at its host path', () => {
    const res = runHelper(['write_override', 'write_bind_mount'], 'write_override override.yml opencode.jsonc 1 1')
    expect(res.status, res.stderr).toBe(0)
    expect(readFileSync(join(workDir, 'override.yml'), 'utf-8')).toBe(`services:
  app:
    environment:
      - OPENCODE_IMPORT_CONFIG_PATH=/import/opencode-config/opencode.jsonc
      - OPENCODE_IMPORT_STATE_PATH=/import/opencode-state
    volumes:
      - type: bind
        source: "\${OCM_OPENCODE_CONFIG_HOST_PATH}"
        target: "/import/opencode-config"
        read_only: true
      - type: bind
        source: "\${OCM_OPENCODE_STATE_HOST_PATH}"
        target: "/import/opencode-state"
        read_only: true
      - type: bind
        source: "\${OCM_REPOS_HOST_PATH}"
        target: "\${OCM_REPOS_HOST_PATH}"
        read_only: false
`)
  })

  it('writes only the repositories mount when nothing is imported', () => {
    const res = runHelper(['write_override', 'write_bind_mount'], "write_override override.yml '' 0 1")
    expect(res.status, res.stderr).toBe(0)
    expect(readFileSync(join(workDir, 'override.yml'), 'utf-8')).toBe(`services:
  app:
    volumes:
      - type: bind
        source: "\${OCM_REPOS_HOST_PATH}"
        target: "\${OCM_REPOS_HOST_PATH}"
        read_only: false
`)
  })

  it('prefers opencode.jsonc over opencode.json and the legacy config.json', () => {
    mkdirSync(join(workDir, 'config'))
    writeFileSync(join(workDir, 'config', 'config.json'), '{}')
    writeFileSync(join(workDir, 'config', 'opencode.json'), '{}')
    expect(runHelper(['find_opencode_config_file'], 'find_opencode_config_file config').stdout).toBe('opencode.json')
    writeFileSync(join(workDir, 'config', 'opencode.jsonc'), '{}')
    expect(runHelper(['find_opencode_config_file'], 'find_opencode_config_file config').stdout).toBe('opencode.jsonc')
    expect(runHelper(['find_opencode_config_file'], 'find_opencode_config_file missing').stdout).toBe('')
  })

  it('single-quotes .env values with spaces and rejects values containing a single quote', () => {
    const ok = runHelper(['fail', 'env_line'], "env_line OCM_REPOS_HOST_PATH '/Users/me/My Repos'")
    expect(ok.stdout).toBe("OCM_REPOS_HOST_PATH='/Users/me/My Repos'\n")
    const rejected = runHelper(['fail', 'env_line'], `env_line OCM_REPOS_HOST_PATH "/Users/me/it's"`)
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('single quote')
  })

  it('expands a leading ~ to HOME', () => {
    const res = runHelper(['expand_home'], 'HOME=/home/me; expand_home "~/code"; printf "|"; expand_home "~"; printf "|"; expand_home /abs')
    expect(res.stdout).toBe('/home/me/code|/home/me|/abs')
  })
})
