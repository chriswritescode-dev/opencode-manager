import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ARTIFACT_LIMITS } from '@opencode-manager/shared/schemas'
import type { OpenCodeClient } from './opencode/client'
import { ServiceError } from '../utils/service-error'
import { isPathWithinRoot } from '../utils/fs-safe'

const ARTIFACT_EXTENSIONS = new Set(['.html', '.htm'])

export class SessionArtifactError extends ServiceError {
  constructor(message: string, status: 400 | 404 | 413) {
    super(message, status)
    this.name = 'SessionArtifactError'
  }
}

/**
 * Validates that a resolved path is a regular `.html`/`.htm` file within the artifact size limit.
 * This is the single owner of the HTML artifact file rules; callers that already know the path is
 * contained pass the lexical display path for error messages.
 */
export async function assertHtmlArtifactFile(filePath: string, displayPath: string): Promise<void> {
  const stats = await fs.stat(filePath).catch(() => {
    throw new SessionArtifactError(`Artifact file not found: ${displayPath}`, 404)
  })
  if (!stats.isFile()) {
    throw new SessionArtifactError(`Artifact file not found: ${displayPath}`, 404)
  }

  if (!ARTIFACT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new SessionArtifactError('Artifact must be an .html file', 400)
  }

  if (stats.size > ARTIFACT_LIMITS.FILE_MAX_BYTES) {
    throw new SessionArtifactError('Artifact file exceeds 5 MB', 413)
  }
}

/**
 * Resolves an `ocm` `show_artifact` path to the absolute path of a self-contained HTML file inside the session
 * directory, rejecting paths that escape it (including through symlinks), non-HTML files and oversized files.
 * Symlinks are resolved for validation only; the returned path stays lexical so callers can map it by the
 * session directory or repo prefix they were given.
 */
export async function resolveSessionArtifactFile(
  openCodeClient: OpenCodeClient,
  sessionId: string,
  artifactPath: string,
): Promise<string> {
  const session = await openCodeClient.api.session.get({ sessionID: sessionId })
  const sessionDirectory = session.location.directory

  let realSessionDirectory: string
  try {
    realSessionDirectory = await fs.realpath(sessionDirectory)
  } catch {
    throw new SessionArtifactError(`Artifact path must be inside the session directory ${sessionDirectory}`, 400)
  }

  const resolved = path.isAbsolute(artifactPath) ? path.resolve(artifactPath) : path.resolve(sessionDirectory, artifactPath)

  let realFile: string
  try {
    realFile = await fs.realpath(resolved)
  } catch {
    throw new SessionArtifactError(`Artifact file not found: ${artifactPath}`, 404)
  }

  if (!isPathWithinRoot(realSessionDirectory, realFile)) {
    throw new SessionArtifactError(`Artifact path must be inside the session directory ${sessionDirectory}`, 400)
  }

  await assertHtmlArtifactFile(realFile, artifactPath)

  return resolved
}
