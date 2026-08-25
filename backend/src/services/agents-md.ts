import { getAgentsMdPath } from '@opencode-manager/shared/config/env'
import { writeFileContent, fileExists } from './file-operations'
import { DEFAULT_AGENTS_MD } from '../constants'
import { logger } from '../utils/logger'

export async function ensureDefaultAgentsMdExists(): Promise<void> {
  const agentsMdPath = getAgentsMdPath()
  const exists = await fileExists(agentsMdPath)

  if (!exists) {
    await writeFileContent(agentsMdPath, DEFAULT_AGENTS_MD)
    logger.info(`Created default AGENTS.md at: ${agentsMdPath}`)
  }
}
