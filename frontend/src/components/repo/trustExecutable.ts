import type { ProjectConfigResponse } from '@opencode-manager/shared/types'

export type RepoFileExecutable = NonNullable<ProjectConfigResponse['repoFile']['executable']>

export function hasExecutableContent(executable: RepoFileExecutable | null | undefined): boolean {
  if (!executable) return false
  return (
    executable.actions.length > 0 ||
    executable.setup.length > 0 ||
    Object.keys(executable.env ?? {}).length > 0 ||
    executable.environment !== undefined
  )
}
