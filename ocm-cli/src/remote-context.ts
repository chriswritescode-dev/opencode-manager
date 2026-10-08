export const REMOTE_MANAGER_URL_ENV = 'OCM_REMOTE_MANAGER_URL'
export const REMOTE_REPO_NAME_ENV = 'OCM_REMOTE_REPO_NAME'
export const REMOTE_REPO_ID_ENV = 'OCM_REMOTE_REPO_ID'

export type RemoteContext = {
  managerUrl: string
  managerHost: string
  repoName?: string
  repoId?: number
}

export function buildRemoteAttachEnv(managerUrl: string, repoName: string, repoId: number): Record<string, string> {
  return {
    [REMOTE_MANAGER_URL_ENV]: managerUrl,
    [REMOTE_REPO_NAME_ENV]: repoName,
    [REMOTE_REPO_ID_ENV]: String(repoId),
  }
}

export function readRemoteContext(env: NodeJS.ProcessEnv): RemoteContext | undefined {
  const urlValue = env[REMOTE_MANAGER_URL_ENV]
  if (!urlValue) return undefined

  const managerUrl = urlValue.trim()

  let managerHost: string
  try {
    managerHost = new URL(managerUrl).host
  } catch {
    managerHost = managerUrl
  }

  const repoName = env[REMOTE_REPO_NAME_ENV] || undefined

  const repoIdValue = Number(env[REMOTE_REPO_ID_ENV])
  const repoId = Number.isInteger(repoIdValue) && repoIdValue > 0 ? repoIdValue : undefined

  return { managerUrl, managerHost, repoName, repoId }
}
