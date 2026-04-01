import { VERSION } from '../version'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const VERSION_CACHE_TTL_MS = 5 * 60 * 1000

let cachedVersion: { value: string | null; expiresAt: number } | null = null

export function resolveOpencodeCacheDir(): string {
  const xdgCacheHome = process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache')
  return join(xdgCacheHome, 'opencode')
}

export async function fetchLatestVersion(): Promise<string | null> {
  if (cachedVersion && Date.now() < cachedVersion.expiresAt) {
    return cachedVersion.value
  }
  try {
    const response = await fetch('https://registry.npmjs.org/@opencode-manager/memory/latest')
    if (!response.ok) {
      return null
    }
    const data = await response.json() as { version: string }
    cachedVersion = { value: data.version, expiresAt: Date.now() + VERSION_CACHE_TTL_MS }
    return data.version
  } catch {
    return null
  }
}

export function getCurrentVersion(): string {
  return VERSION
}

export interface UpgradeResult {
  upgraded: boolean
  from: string
  to: string
  message: string
}

export interface UpgradeCheckResult {
  current: string
  latest: string | null
  updateAvailable: boolean
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aNum = aParts[i] || 0
    const bNum = bParts[i] || 0
    if (aNum !== bNum) {
      return aNum - bNum
    }
  }
  return 0
}

export async function checkForUpdate(): Promise<UpgradeCheckResult> {
  const latest = await fetchLatestVersion()
  const current = getCurrentVersion()
  const updateAvailable = latest !== null && compareVersions(latest, current) > 0
  return { current, latest, updateAvailable }
}

export function updateCachePackageJson(cacheDir: string, version: string): void {
  const packageJsonPath = join(cacheDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8')
    const packageJson = JSON.parse(content) as { dependencies?: Record<string, string> }
    if (packageJson.dependencies) {
      packageJson.dependencies['@opencode-manager/memory'] = version
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8')
    }
  } catch {
  }
}

export async function performUpgrade(
  runInstall: (cacheDir: string, version: string) => Promise<{ exitCode: number; stderr: string }>
): Promise<UpgradeResult> {
  const checkResult = await checkForUpdate()
  const { current, latest } = checkResult

  if (!latest || !checkResult.updateAvailable) {
    return {
      upgraded: false,
      from: current,
      to: current,
      message: 'Already on latest version',
    }
  }

  const cacheDir = resolveOpencodeCacheDir()

  if (!existsSync(cacheDir)) {
    return {
      upgraded: false,
      from: current,
      to: latest,
      message: 'OpenCode cache directory not found. Run OpenCode first to initialize the plugin.',
    }
  }

  const installResult = await runInstall(cacheDir, latest)

  if (installResult.exitCode !== 0) {
    return {
      upgraded: false,
      from: current,
      to: latest,
      message: `Upgrade failed: ${installResult.stderr || 'Unknown error'}`,
    }
  }

  updateCachePackageJson(cacheDir, latest)

  return {
    upgraded: true,
    from: current,
    to: latest,
    message: `Successfully upgraded from v${current} to v${latest}`,
  }
}

export function formatUpgradeCheck(check: UpgradeCheckResult): string {
  if (check.latest === null) {
    return `v${check.current} (unable to check for updates)`
  }
  if (check.updateAvailable) {
    return `v${check.current} → v${check.latest} available. Run memory-health with action 'upgrade' to update.`
  }
  return `v${check.current} (latest)`
}
