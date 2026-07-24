#!/usr/bin/env bun

import { spawnSync, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'

const VERSION = '0.15.0'

const USAGE = `
opencode-manager v${VERSION}

Usage:
  opencode-manager              Start the server
  opencode-manager --version    Show version
  opencode-manager --help       Show this help

Environment:
  PORT                  Backend port (default: 5003)
  HOST                  Bind address (default: 0.0.0.0)
  AUTH_SECRET           Required in production. Generate: openssl rand -base64 32
  DATABASE_PATH         SQLite database path (default: ./data/opencode.db)
  WORKSPACE_PATH        Workspace root (default: ./workspace)
`

function die(msg: string, code = 1): never {
  process.stderr.write(`opencode-manager: ${msg}\n`)
  process.exit(code)
}

function info(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

function warn(msg: string): void {
  process.stderr.write(`opencode-manager: warning: ${msg}\n`)
}

function hasCommand(cmd: string): boolean {
  try {
    const result = spawnSync('which', [cmd], { stdio: 'pipe' })
    return result.status === 0
  } catch {
    return false
  }
}

function run(cmd: string, args: string[], opts: { stdio?: 'pipe' | 'inherit'; cwd?: string } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    stdio: opts.stdio ?? 'pipe',
    cwd: opts.cwd,
    encoding: 'utf-8',
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function ensureBun(): void {
  if (hasCommand('bun')) return

  info('Bun not found. Installing...')
  const install = spawnSync('curl', ['-fsSL', 'https://bun.sh/install'], {
    stdio: 'pipe',
    shell: true,
  })
  if (install.status !== 0) {
    die('Failed to install Bun. Install manually: https://bun.sh')
  }
  // Re-check after install
  const homeBin = join(homedir(), '.bun', 'bin')
  process.env.PATH = `${homeBin}:${process.env.PATH}`
  if (!hasCommand('bun')) {
    die('Bun installed but not found in PATH. Restart your shell or add ~/.bun/bin to PATH.')
  }
  info('Bun installed successfully.')
}

function ensureOpencode(): void {
  if (hasCommand('opencode')) {
    // Check version
    const v = run('opencode', ['--version'])
    const match = v.stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) {
      const ver = match[1]
      if (ver >= '1.0.137') {
        info(`OpenCode ${ver} found.`)
        return
      }
      warn(`OpenCode ${ver} is below recommended >=1.0.137. Upgrading...`)
    }
  } else {
    info('OpenCode not found. Installing...')
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
  const url = `https://github.com/anomalyco/opencode/releases/latest/download/opencode-${platform}-${arch}.tar.gz`

  const curl = spawnSync('curl', ['-fsSL', url, '-o', '/tmp/opencode.tar.gz'], { stdio: 'pipe' })
  if (curl.status !== 0) {
    die('Failed to download OpenCode.')
  }

  const tar = spawnSync('tar', ['-xzf', '/tmp/opencode.tar.gz', '-C', '/tmp'], { stdio: 'pipe' })
  if (tar.status !== 0) {
    die('Failed to extract OpenCode.')
  }

  const binDir = join(homedir(), '.local', 'bin')
  mkdirSync(binDir, { recursive: true })

  const mv = spawnSync('mv', ['/tmp/opencode', join(binDir, 'opencode')], { stdio: 'pipe' })
  if (mv.status !== 0) {
    die('Failed to install OpenCode binary.')
  }

  spawnSync('chmod', ['755', join(binDir, 'opencode')], { stdio: 'pipe' })

  process.env.PATH = `${binDir}:${process.env.PATH}`
  info('OpenCode installed successfully.')
}

function ensureGit(): void {
  if (hasCommand('git')) return
  die('Git is not installed. Please install Git and try again.')
}

function getPackageDir(): string {
  // When run via bunx, import.meta.dir is the bin/ directory inside the cached package
  return resolve(import.meta.dir, '..')
}

function ensureDataDir(pkgDir: string): { dataDir: string; workspaceDir: string } {
  const dataDir = process.env.DATA_DIR ?? join(homedir(), '.opencode-manager')
  const workspaceDir = process.env.WORKSPACE_PATH ?? join(dataDir, 'workspace')

  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'repos'), { recursive: true })
  mkdirSync(join(dataDir, 'data'), { recursive: true })
  mkdirSync(workspaceDir, { recursive: true })
  mkdirSync(join(workspaceDir, '.config', 'opencode'), { recursive: true })

  return { dataDir, workspaceDir }
}

function ensureEnvFile(dataDir: string): void {
  const envPath = join(dataDir, '.env')
  if (existsSync(envPath)) return

  const secret = randomBytes(32).toString('base64').slice(0, 32)
  const content = [
    `NODE_ENV=production`,
    `PORT=5003`,
    `HOST=0.0.0.0`,
    `DATABASE_PATH=${join(dataDir, 'data', 'opencode.db')}`,
    `WORKSPACE_PATH=${join(dataDir, 'workspace')}`,
    `AUTH_SECRET=${secret}`,
    `OPENCODE_SERVER_PORT=5551`,
    `OPENCODE_HOST=127.0.0.1`,
  ].join('\n') + '\n'

  writeFileSync(envPath, content)
  info(`Created ${envPath}`)
  info(`AUTH_SECRET generated. Edit ${envPath} to customize.`)
}

function installDeps(pkgDir: string): void {
  const nodeModules = join(pkgDir, 'node_modules')
  if (existsSync(nodeModules)) {
    info('Dependencies already installed.')
    return
  }

  info('Installing dependencies...')
  const result = run('bun', ['install', '--frozen-lockfile'], { cwd: pkgDir, stdio: 'inherit' })
  if (result.status !== 0) {
    // Fallback without frozen lockfile
    const fallback = run('bun', ['install'], { cwd: pkgDir, stdio: 'inherit' })
    if (fallback.status !== 0) {
      die('Failed to install dependencies.')
    }
  }
  info('Dependencies installed.')
}

function buildFrontend(pkgDir: string): void {
  const distDir = join(pkgDir, 'frontend', 'dist')
  if (existsSync(distDir)) {
    info('Frontend already built.')
    return
  }

  info('Building frontend...')
  const result = run('bun', ['run', 'build:frontend'], { cwd: pkgDir, stdio: 'inherit' })
  if (result.status !== 0) {
    die('Failed to build frontend.')
  }
  info('Frontend built.')
}

async function startServer(pkgDir: string, dataDir: string): Promise<void> {
  const envFile = join(dataDir, '.env')
  if (existsSync(envFile)) {
    // Load env file
    const content = readFileSync(envFile, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  }

  // Ensure production mode
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production'

  const port = process.env.PORT ?? '5003'
  const host = process.env.HOST ?? '0.0.0.0'

  info(`Starting OpenCode Manager on http://${host}:${port}`)
  info(`Data directory: ${dataDir}`)
  info('Press Ctrl+C to stop.')

  const backendEntry = join(pkgDir, 'backend', 'src', 'index.ts')
  const child = spawn('bun', ['run', backendEntry], {
    cwd: pkgDir,
    stdio: 'inherit',
    env: { ...process.env },
  })

  child.on('close', (code) => process.exit(code ?? 0))
  child.on('error', (err) => die(`Failed to start server: ${err.message}`))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    info(USAGE)
    return
  }

  if (args.includes('--version') || args.includes('-v')) {
    info(VERSION)
    return
  }

  const pkgDir = getPackageDir()

  info('Checking prerequisites...')
  ensureGit()
  ensureBun()
  ensureOpencode()

  const { dataDir } = ensureDataDir(pkgDir)
  ensureEnvFile(dataDir)

  installDeps(pkgDir)
  buildFrontend(pkgDir)
  await startServer(pkgDir, dataDir)
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)))
