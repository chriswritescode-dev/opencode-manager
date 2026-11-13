import { z } from 'zod'
import type { RemoteRepoSummary } from './mirror.js'

const ManagerRepoSchema = z.object({
  repoId: z.number(),
  name: z.string(),
  branch: z.string().nullable(),
  cloneStatus: z.string(),
  directory: z.string(),
  projectId: z.string().nullable().optional(),
  isWorktree: z.boolean().optional(),
  extra: z.object({
    repoId: z.number(),
    localPath: z.string(),
    fullPath: z.string(),
  }),
})

export type ManagerRepo = z.infer<typeof ManagerRepoSchema>

const ManagerReposResponseSchema = z.object({ workspaces: z.array(ManagerRepoSchema) })

export async function fetchRepos(managerUrl: string, token: string): Promise<ManagerRepo[]> {
  const res = await fetch(`${managerUrl}/api/internal/opencode-workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`manager responded ${res.status} ${res.statusText}`)
  }
  return ManagerReposResponseSchema.parse(await res.json()).workspaces
}

export function toRemoteRepoSummaries(repos: ManagerRepo[]): RemoteRepoSummary[] {
  return repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    projectId: r.projectId ?? null,
    branch: r.branch,
  }))
}
