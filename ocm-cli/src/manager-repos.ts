import type { RemoteRepoSummary } from './mirror.js'

export interface ManagerRepo {
  repoId: number
  name: string
  branch: string | null
  cloneStatus: string
  directory: string
  projectId?: string | null
  extra: { repoId: number; localPath: string; fullPath: string }
}

export async function fetchRepos(managerUrl: string, token: string): Promise<ManagerRepo[]> {
  const res = await fetch(`${managerUrl}/api/internal/opencode-workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`manager responded ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { workspaces: ManagerRepo[] }
  return data.workspaces
}

export function toRemoteRepoSummaries(repos: ManagerRepo[]): RemoteRepoSummary[] {
  return repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    projectId: r.projectId ?? null,
    branch: r.branch,
  }))
}
