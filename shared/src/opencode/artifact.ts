import type { SessionMessageAssistantTool } from '@opencode/client'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_SHOW_ARTIFACT_ACTION, ShowArtifactParamsSchema } from '../schemas/internal-assistant'
import type { ShowArtifactParams } from '../schemas/internal-assistant'

/**
 * Reads an assistant tool part as a completed `ocm` `show_artifact` call, or undefined for every
 * other tool, action, unfinished state, and set of parameters that does not validate.
 */
export function readShowArtifactCall(part: SessionMessageAssistantTool): ShowArtifactParams | undefined {
  if (part.name !== MANAGER_TOOL_NAME || part.state.status !== 'completed') return undefined
  if (part.state.input.action !== MANAGER_TOOL_SHOW_ARTIFACT_ACTION) return undefined
  const parsed = ShowArtifactParamsSchema.safeParse(part.state.input.params)
  return parsed.success ? parsed.data : undefined
}
