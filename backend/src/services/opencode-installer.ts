import { spawnSync } from 'child_process'
import { promises as fs, readdirSync } from 'fs'
import os from 'os'
import path from 'path'
import {
  OPENCODE_MIN_VERSION,
  buildOpenCodeReleaseAsset,
  isSupportedOpenCodeVersion,
} from '@opencode-manager/shared/opencode'
import { mkdirSafe } from '../utils/fs-safe'
import { compareVersions } from '../utils/version-utils'
import { getOpenCodeHome } from './opencode-home'

const OPENCODE_REGISTRY_URL = 'https://registry.npmjs.org/@opencode/cli'
const OPENCODE_STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const OPENCODE_MUSL_LOADER_PREFIX = 'ld-musl-'
const OPENCODE_VERSION_PATTERN = /(\d+\.\d+\.\d+)/

export interface OpenCodeInstallTarget {
  platform: NodeJS.Platform
  arch: string
  musl: boolean
}

export interface OpenCodeRelease {
  version: string
  publishedAt: string | null
}

export interface InstallOpenCodeOptions {
  fetch?: typeof fetch
  homeDirectory?: string
  target?: OpenCodeInstallTarget
}

interface OpenCodeRegistry {
  'dist-tags'?: Record<string, unknown>
  versions?: Record<string, unknown>
  time?: Record<string, unknown>
}

export function resolveOpenCodeBinaryPath(homeDirectory: string): string {
  return path.join(homeDirectory, '.opencode', 'bin', 'opencode')
}

export function resolveOpenCodeInstallTarget(): OpenCodeInstallTarget {
  return {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === 'linux' && hasMuslLoader(),
  }
}

function hasMuslLoader(): boolean {
  try {
    return readdirSync('/lib').some((entry) => entry.startsWith(OPENCODE_MUSL_LOADER_PREFIX))
  } catch {
    return false
  }
}

async function fetchOpenCodeRegistry(fetchFn: typeof fetch): Promise<OpenCodeRegistry> {
  const response = await fetchFn(OPENCODE_REGISTRY_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenCode releases: registry responded with HTTP ${response.status}`)
  }
  return await response.json() as OpenCodeRegistry
}

export async function listOpenCodeVersions(fetchFn: typeof fetch = fetch): Promise<OpenCodeRelease[]> {
  const registry = await fetchOpenCodeRegistry(fetchFn)
  const publishedTimes = registry.time ?? {}
  return Object.keys(registry.versions ?? {})
    .filter((version) => OPENCODE_STABLE_VERSION_PATTERN.test(version) && isSupportedOpenCodeVersion(version))
    .map((version) => ({
      version,
      publishedAt: typeof publishedTimes[version] === 'string' ? publishedTimes[version] as string : null,
    }))
    .sort((left, right) => compareVersions(right.version, left.version))
}

export async function latestOpenCodeVersion(fetchFn: typeof fetch = fetch): Promise<string> {
  const registry = await fetchOpenCodeRegistry(fetchFn)
  const latest = registry['dist-tags']?.latest
  if (typeof latest !== 'string' || !isSupportedOpenCodeVersion(latest)) {
    throw new Error(`OpenCode registry latest release is not a supported version: ${String(latest)}`)
  }
  return latest.trim().replace(/^v/, '')
}

export async function installOpenCodeVersion(
  version: string,
  options: InstallOpenCodeOptions = {},
): Promise<string> {
  const requestedVersion = version.trim().replace(/^v/, '')
  if (!isSupportedOpenCodeVersion(requestedVersion)) {
    throw new Error(`OpenCode ${OPENCODE_MIN_VERSION} or newer is required; refusing to install ${version}`)
  }

  const fetchFn = options.fetch ?? fetch
  const homeDirectory = options.homeDirectory ?? getOpenCodeHome()
  const asset = buildOpenCodeReleaseAsset(requestedVersion, options.target ?? resolveOpenCodeInstallTarget())
  const binaryPath = resolveOpenCodeBinaryPath(homeDirectory)
  const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-install-'))

  try {
    const archivePath = path.join(stagingDirectory, asset.archive === 'zip' ? 'opencode.zip' : 'opencode.tar.gz')
    const response = await fetchFn(asset.url)
    if (!response.ok) {
      throw new Error(`Failed to download OpenCode ${requestedVersion} from ${asset.url}: HTTP ${response.status}`)
    }
    await fs.writeFile(archivePath, new Uint8Array(await response.arrayBuffer()))

    const extraction = asset.archive === 'zip'
      ? spawnSync('unzip', ['-o', archivePath, '-d', stagingDirectory], { encoding: 'utf8' })
      : spawnSync('tar', ['-xzf', archivePath, '-C', stagingDirectory], { encoding: 'utf8' })
    if (extraction.error) {
      throw new Error(`Failed to extract the OpenCode ${requestedVersion} archive: ${extraction.error.message}`)
    }
    if (extraction.status !== 0) {
      throw new Error(`Failed to extract the OpenCode ${requestedVersion} archive: ${extraction.stderr || extraction.stdout}`)
    }

    const stagedBinaryPath = path.join(stagingDirectory, 'opencode')
    await fs.chmod(stagedBinaryPath, 0o755)

    const probe = spawnSync(stagedBinaryPath, ['--version'], { encoding: 'utf8' })
    const detectedVersion = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.match(OPENCODE_VERSION_PATTERN)?.[1]
    if (detectedVersion !== requestedVersion) {
      throw new Error(`Downloaded OpenCode binary reports ${detectedVersion ?? 'no version'}; expected ${requestedVersion}`)
    }

    const binDirectory = path.dirname(binaryPath)
    await mkdirSafe(binDirectory)
    const pendingPath = path.join(binDirectory, `.opencode.ocm-tmp-${process.pid}-${Date.now()}`)
    try {
      await fs.copyFile(stagedBinaryPath, pendingPath)
      await fs.chmod(pendingPath, 0o755)
      await fs.rename(pendingPath, binaryPath)
    } catch (error) {
      await fs.rm(pendingPath, { force: true }).catch(() => undefined)
      throw error
    }

    return binaryPath
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true })
  }
}
