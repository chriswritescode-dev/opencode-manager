import { spawnSync } from 'child_process'
import { createWriteStream, promises as fs, readdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import {
  buildOpenCodeReleaseAsset,
  compareOpenCodeVersions,
  describeUnsupportedOpenCodeVersion,
  isStableOpenCodeVersion,
  isSupportedOpenCodeVersion,
  normalizeOpenCodeVersion,
  parseOpenCodeVersionOutput,
} from '@opencode-manager/shared/opencode'
import { mkdirSafe } from '../utils/fs-safe'
import { getOpenCodeHome } from './opencode-home'

const OPENCODE_REGISTRY_URL = 'https://registry.npmjs.org/@opencode/cli'
const OPENCODE_REGISTRY_LATEST_URL = `${OPENCODE_REGISTRY_URL}/latest`
const OPENCODE_VERSION_CACHE_TTL_MS = 5 * 60 * 1000
const OPENCODE_MUSL_LOADER_PREFIX = 'ld-musl-'

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

export interface OpenCodeRegistryOptions {
  fetch?: typeof fetch
  now?: () => number
}

interface OpenCodeRegistry {
  versions?: Record<string, unknown>
  time?: Record<string, unknown>
}

interface OpenCodeRegistryLatest {
  version?: unknown
}

interface CachedOpenCodeReleases {
  releases: OpenCodeRelease[]
  fetchedAt: number
}

let cachedOpenCodeReleases: CachedOpenCodeReleases | null = null

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

function isInstallableOpenCodeVersion(version: string): boolean {
  return isStableOpenCodeVersion(version) && isSupportedOpenCodeVersion(version)
}

async function fetchOpenCodeRegistryJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const response = await fetchFn(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenCode releases: registry responded with HTTP ${response.status}`)
  }
  return await response.json() as T
}

export function clearOpenCodeVersionCache(): void {
  cachedOpenCodeReleases = null
}

export async function listOpenCodeVersions(options: OpenCodeRegistryOptions = {}): Promise<OpenCodeRelease[]> {
  const now = (options.now ?? Date.now)()
  if (cachedOpenCodeReleases && now - cachedOpenCodeReleases.fetchedAt < OPENCODE_VERSION_CACHE_TTL_MS) {
    return cachedOpenCodeReleases.releases
  }

  const registry = await fetchOpenCodeRegistryJson<OpenCodeRegistry>(options.fetch ?? fetch, OPENCODE_REGISTRY_URL)
  const publishedTimes = registry.time ?? {}
  const releases = Object.keys(registry.versions ?? {})
    .filter(isInstallableOpenCodeVersion)
    .map((version) => ({
      version,
      publishedAt: typeof publishedTimes[version] === 'string' ? publishedTimes[version] as string : null,
    }))
    .sort((left, right) => compareOpenCodeVersions(right.version, left.version))

  cachedOpenCodeReleases = { releases, fetchedAt: now }
  return releases
}

export async function latestOpenCodeVersion(options: OpenCodeRegistryOptions = {}): Promise<string> {
  const latest = await fetchOpenCodeRegistryJson<OpenCodeRegistryLatest>(options.fetch ?? fetch, OPENCODE_REGISTRY_LATEST_URL)
  if (typeof latest.version !== 'string' || !isInstallableOpenCodeVersion(latest.version)) {
    throw new Error(`OpenCode registry latest release is not a supported version: ${String(latest.version)}`)
  }
  return normalizeOpenCodeVersion(latest.version)
}

async function downloadToFile(response: Response, filePath: string): Promise<void> {
  if (!response.body) throw new Error('OpenCode download returned an empty body')
  await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(filePath))
}

export async function installOpenCodeVersion(
  version: string,
  options: InstallOpenCodeOptions = {},
): Promise<string> {
  const requestedVersion = normalizeOpenCodeVersion(version)
  if (!isInstallableOpenCodeVersion(requestedVersion)) {
    throw new Error(`${describeUnsupportedOpenCodeVersion(version)}; refusing to install it`)
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
    await downloadToFile(response, archivePath)

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
    const detectedVersion = parseOpenCodeVersionOutput(`${probe.stdout ?? ''}${probe.stderr ?? ''}`)
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
