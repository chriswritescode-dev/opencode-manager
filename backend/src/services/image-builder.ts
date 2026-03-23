import type { DevcontainerConfig } from '@opencode-manager/shared'
import { execCommand } from '../utils/process'
import { logger } from '../utils/logger'
import path from 'path'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const WORKSPACE_BASE = getWorkspacePath()
const DEVCONTAINERS_PATH = path.join(WORKSPACE_BASE, 'devcontainers')

export class ImageBuilder {
  private imagePrefix = 'opencode-session'

  getImageTag(templateName: string, configHash: string): string {
    return `${this.imagePrefix}:${templateName}-${configHash}`
  }

  async imageExists(imageTag: string): Promise<boolean> {
    const result = await execCommand(
      ['docker', 'image', 'inspect', imageTag],
      { ignoreExitCode: true, silent: true }
    ) as { exitCode: number }

    return result.exitCode === 0
  }

  async buildImage(templateName: string, configHash: string, config: DevcontainerConfig): Promise<string> {
    const imageTag = this.getImageTag(templateName, configHash)
    const templatePath = path.join(DEVCONTAINERS_PATH, templateName)
    const contextPath = path.join(templatePath, config.build.context || '.')
    const dockerfilePath = path.join(templatePath, config.build.dockerfile)
    const buildArgs = {
      ...config.build.args,
      DEVCONTAINER_HASH: configHash,
    }

    const args = ['docker', 'build', '-f', dockerfilePath, '-t', imageTag]
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push('--build-arg', `${key}=${value}`)
    }
    args.push(contextPath)

    logger.info(`Building image ${imageTag} from ${templateName}`)
    await execCommand(args, { cwd: templatePath })
    logger.info(`Built image ${imageTag}`)

    return imageTag
  }

  async ensureImage(templateName: string, configHash: string, config: DevcontainerConfig): Promise<string> {
    const imageTag = this.getImageTag(templateName, configHash)
    const exists = await this.imageExists(imageTag)
    if (exists) {
      return imageTag
    }

    return this.buildImage(templateName, configHash, config)
  }
}
