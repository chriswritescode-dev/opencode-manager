export const REMOTE_MANAGER_URL_ENV = 'OCM_REMOTE_MANAGER_URL'
export const REMOTE_REPO_NAME_ENV = 'OCM_REMOTE_REPO_NAME'

export type RemoteContext = {
  managerHost: string
  repoName?: string
}

export function buildRemoteAttachEnv(managerUrl: string, repoName: string): Record<string, string> {
  return {
    [REMOTE_MANAGER_URL_ENV]: managerUrl,
    [REMOTE_REPO_NAME_ENV]: repoName,
  }
}

export function readRemoteContext(env: NodeJS.ProcessEnv): RemoteContext | undefined {
  const urlValue = env[REMOTE_MANAGER_URL_ENV]
  if (!urlValue) return undefined

  let managerHost: string
  try {
    managerHost = new URL(urlValue).host
  } catch {
    managerHost = urlValue.trim()
  }

  const repoName = env[REMOTE_REPO_NAME_ENV] || undefined

  return { managerHost, repoName }
}