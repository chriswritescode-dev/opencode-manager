import path from 'path'
import type { Database } from 'bun:sqlite'
import { getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import type { RepoWorktreeSchedule } from '@opencode-manager/shared/utils'
import { listRunningScheduleRuns, listScheduleJobWorktreeOwners } from '../db/schedules'
import { canonicalPathSync } from '../utils/fs-safe'

const SCHEDULE_WORKTREE_DIRECTORY = /^job-(\d+)-(?:run-(\d+)|shared)$/

export function getScheduleWorktreePath(jobId: number, runId: number | null): string {
  return path.join(getScheduleWorktreesPath(), runId === null ? `job-${jobId}-shared` : `job-${jobId}-run-${runId}`)
}

export function getScheduleWorktreeBranch(jobId: number, runId: number | null): string {
  return runId === null ? `schedule/${jobId}/shared` : `schedule/${jobId}/run-${runId}`
}

export function parseScheduleWorktreeName(name: string): { jobId: number; runId: number | null } | null {
  const match = SCHEDULE_WORKTREE_DIRECTORY.exec(name)
  if (!match) return null
  return { jobId: Number(match[1]), runId: match[2] ? Number(match[2]) : null }
}

export function isSharedScheduleWorktreePath(worktreePath: string): boolean {
  return parseScheduleWorktreeName(path.basename(worktreePath))?.runId === null
}

export function createScheduleWorktreeDescriber(database: Database): (directory: string) => RepoWorktreeSchedule | undefined {
  const scheduleRoot = canonicalPathSync(path.resolve(getScheduleWorktreesPath()))
  const jobsById = new Map(listScheduleJobWorktreeOwners(database).map((job) => [job.id, job] as const))
  const runningRuns = listRunningScheduleRuns(database)
  const runningByDirectory = new Map(runningRuns.flatMap((run) => (
    run.worktreePath ? [[canonicalPathSync(path.resolve(run.worktreePath)), run] as const] : []
  )))

  return (directory) => {
    const canonicalDirectory = canonicalPathSync(path.resolve(directory))
    const running = runningByDirectory.get(canonicalDirectory)
    const parsed = path.dirname(canonicalDirectory) === scheduleRoot ? parseScheduleWorktreeName(path.basename(canonicalDirectory)) : null
    const jobId = parsed?.jobId ?? running?.jobId
    if (jobId === undefined) return undefined
    const job = jobsById.get(jobId)
    if (!job) return undefined
    return {
      repoId: job.repoId,
      jobId,
      runId: parsed ? parsed.runId : (running?.id ?? null),
      inUse: running !== undefined || (parsed?.runId === null && runningRuns.some((run) => run.jobId === jobId)),
      name: job.name,
    }
  }
}
