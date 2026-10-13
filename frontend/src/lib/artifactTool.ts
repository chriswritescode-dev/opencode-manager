import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_SHOW_ARTIFACT_ACTION, ShowArtifactParamsSchema } from '@opencode-manager/shared/schemas'

interface ShowArtifactCall {
  title: string
  path: string
  resolvedPath?: string
}

/**
 * Reads an assistant tool part as a completed `ocm` `show_artifact` call, or undefined for every
 * other tool, action, unfinished state, and set of parameters that does not validate. `resolvedPath`
 * is the absolute path the backend validated inside the session directory, when it recorded one.
 */
export function readShowArtifactCall(part: SessionMessageAssistantTool): ShowArtifactCall | undefined {
  if (part.name !== MANAGER_TOOL_NAME || part.state.status !== 'completed') return undefined
  if (part.state.input.action !== MANAGER_TOOL_SHOW_ARTIFACT_ACTION) return undefined
  const parsed = ShowArtifactParamsSchema.safeParse(part.state.input.params)
  if (!parsed.success) return undefined
  const resolvedPath = part.state.metadata?.path
  return {
    ...parsed.data,
    resolvedPath: typeof resolvedPath === 'string' && resolvedPath.length > 0 ? resolvedPath : undefined,
  }
}
