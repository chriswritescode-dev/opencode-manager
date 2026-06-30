import type { Database } from 'bun:sqlite'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { hostname } from 'os'
import { executeCommand } from '../utils/process'
import {
  insertUpgradeJob,
  updateUpgradeJob,
  getLatestUpgradeJob,
  getActiveUpgradeJob,
} from '../db/manager-upgrade'
import type { ManagerUpgradeJob } from '../db/manager-upgrade'

export interface SelfContainerInfo {
  containerId: string
  project: string
  service: string
  workingDir: string
  image: string
}

export interface DockerRunner {
  inspectSelf(): Promise<SelfContainerInfo>
  pull(image: string): Promise<void>
  spawnRecreate(info: SelfContainerInfo, targetImage: string): void
}

/**
 * Replace only the tag suffix of a Docker image reference, preserving
 * registry ports (e.g. `localhost:5000/org/app:old` → `localhost:5000/org/app:new`).
 * If the image has no tag, appends `:newTag`.
 */
export function replaceImageTag(image: string, newTag: string): string {
  const lastSlash = image.lastIndexOf('/')
  const lastColon = image.lastIndexOf(':')

  if (lastColon > lastSlash) {
    return image.slice(0, lastColon) + ':' + newTag
  }

  return image + ':' + newTag
}

export class ManagerUpgradeError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface UpgradeCapability {
  inDocker: boolean
  socket: boolean
  enabled: boolean
}

export class ManagerUpgradeService {
  constructor(
    private readonly db: Database,
    private readonly deps: {
      runner: DockerRunner
      getCurrentVersion: () => Promise<string | null>
      capability: () => UpgradeCapability
    },
  ) {
    this.reconcile()
  }

  reconcile(): void {
    const active = getActiveUpgradeJob(this.db)
    if (!active) return

    if (active.status === 'pulling' || active.status === 'pending') {
      updateUpgradeJob(this.db, active.id, {
        status: 'failed',
        error: 'interrupted by restart',
        finishedAt: Date.now(),
      })
      return
    }

    if (active.status === 'recreating') {
      void this.deps.getCurrentVersion().then((currentVersion) => {
        if (!currentVersion) return
        if (currentVersion === active.toVersion || (active.fromVersion !== null && currentVersion !== active.fromVersion)) {
          updateUpgradeJob(this.db, active.id, {
            status: 'completed',
            finishedAt: Date.now(),
            error: null,
          })
        }
      })
    }
  }

  async getStatus(): Promise<{
    supported: boolean
    inDocker: boolean
    socketAvailable: boolean
    enabled: boolean
    currentVersion: string | null
    job: ManagerUpgradeJob | null
  }> {
    const cap = this.deps.capability()
    const currentVersion = await this.deps.getCurrentVersion()
    return {
      supported: cap.inDocker && cap.socket && cap.enabled,
      inDocker: cap.inDocker,
      socketAvailable: cap.socket,
      enabled: cap.enabled,
      currentVersion,
      job: getLatestUpgradeJob(this.db),
    }
  }

  async startUpgrade(targetTag?: string): Promise<ManagerUpgradeJob> {
    const cap = this.deps.capability()
    const supported = cap.inDocker && cap.socket && cap.enabled

    if (!supported) {
      throw new ManagerUpgradeError(
        'Manager self-upgrade is only available in Docker with a mounted docker socket',
        400,
      )
    }

    // Check for an existing active job before any async Docker/version calls.
    // This prevents a hung inspectSelf() from blocking the 409 response.
    const activeEarly = getActiveUpgradeJob(this.db)
    if (activeEarly) {
      throw new ManagerUpgradeError('An upgrade is already in progress', 409)
    }

    const currentVersion = await this.deps.getCurrentVersion()
    const info = await this.deps.runner.inspectSelf()

    const baseImage = process.env.OCM_IMAGE || info.image
    const resolvedTag = targetTag ?? 'latest'
    const targetImage = replaceImageTag(baseImage, resolvedTag)

    // Synchronous check immediately before insert — no race with concurrent calls
    const active = getActiveUpgradeJob(this.db)
    if (active) {
      throw new ManagerUpgradeError('An upgrade is already in progress', 409)
    }

    const job = insertUpgradeJob(this.db, {
      status: 'pending',
      fromVersion: currentVersion ?? undefined,
      toVersion: resolvedTag,
      targetImage,
      startedAt: Date.now(),
    })

    updateUpgradeJob(this.db, job.id, { status: 'pulling' })

    try {
      await this.deps.runner.pull(targetImage)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateUpgradeJob(this.db, job.id, {
        status: 'failed',
        error: message,
        finishedAt: Date.now(),
      })
      throw new ManagerUpgradeError(message, 500)
    }

    updateUpgradeJob(this.db, job.id, { status: 'recreating' })
    this.deps.runner.spawnRecreate(info, targetImage)

    return getLatestUpgradeJob(this.db) as ManagerUpgradeJob
  }
}

function parseContainerId(): string {
  try {
    const mountinfo = readFileSync('/proc/self/mountinfo', 'utf-8')
    const match = mountinfo.match(/\/docker\/containers\/([a-f0-9]+)\//)
    if (match?.[1]) return match[1]
  } catch { void null }
  return hostname()
}

export function createDockerRunner(): DockerRunner {
  return {
    async inspectSelf(): Promise<SelfContainerInfo> {
      const containerId = parseContainerId()
      const output = await executeCommand([
        'docker', 'inspect', containerId,
        '--format', '{{json .Config.Labels}}|{{.Config.Image}}',
      ])

      const pipeIdx = output.indexOf('|')
      const labelsJson = output.slice(0, pipeIdx)
      const image = output.slice(pipeIdx + 1).trim()
      const labels: Record<string, string> = JSON.parse(labelsJson)

      return {
        containerId,
        project: labels['com.docker.compose.project'] || '',
        service: labels['com.docker.compose.service'] || '',
        workingDir: labels['com.docker.compose.project.working_dir'] || '',
        image,
      }
    },

    async pull(image: string): Promise<void> {
      await executeCommand(['docker', 'pull', image], { timeout: 600000 })
    },

    spawnRecreate(info: SelfContainerInfo, targetImage: string): void {
      const socketBind = '/var/run/docker.sock:/var/run/docker.sock'
      const workBind = `${info.workingDir}:${info.workingDir}`

      // Dynamic values are passed as environment variables (separate spawn
      // args, never interpreted by a shell) and referenced inside the
      // static shell command via $VAR — no shell injection possible.
      spawn('docker', [
        'run', '-d', '--rm',
        '-v', socketBind,
        '-v', workBind,
        '-w', info.workingDir,
        '-e', `OCM_IMAGE=${targetImage}`,
        '-e', `COMPOSE_PROJECT=${info.project}`,
        '-e', `COMPOSE_SERVICE=${info.service}`,
        'docker:cli',
        'sh', '-c',
        'sleep 2; docker compose -p "$COMPOSE_PROJECT" pull "$COMPOSE_SERVICE" && docker compose -p "$COMPOSE_PROJECT" up -d --no-build "$COMPOSE_SERVICE"',
      ], { detached: true, stdio: 'ignore' }).unref()
    },
  }
}
