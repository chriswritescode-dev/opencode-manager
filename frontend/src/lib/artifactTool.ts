import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { z } from 'zod'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_SHOW_ARTIFACT_ACTION, ShowArtifactParamsSchema } from '@opencode-manager/shared/schemas'

interface ShowArtifactCall {
  title: string
  path: string
  resolvedPath?: string
}

export function readShowArtifactCall(part: SessionMessageAssistantTool): ShowArtifactCall | undefined {
  if (part.name !== MANAGER_TOOL_NAME || part.state.status !== 'completed') return undefined
  if (part.state.input.action !== MANAGER_TOOL_SHOW_ARTIFACT_ACTION) return undefined
  const parsed = ShowArtifactParamsSchema.safeParse(part.state.input.params)
  if (!parsed.success) return undefined
  const resolvedPath = z.string().min(1).safeParse(part.state.metadata?.path)
  return {
    ...parsed.data,
    resolvedPath: resolvedPath.success ? resolvedPath.data : undefined,
  }
}
