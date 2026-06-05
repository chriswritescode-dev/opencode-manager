import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  listAllScheduleJobsWithRepos,
  listAllScheduleRuns,
} from '../../src/db/schedules'

describe('assistant repo (repo_id=0) in global aggregate queries', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Disable FK enforcement to match bun:sqlite default behavior (OFF)
    db.exec('PRAGMA foreign_keys = OFF')
    migrate(db, allMigrations)

    const now = Date.now()

    // Insert a real repo (id=1)
    db.exec(
      `INSERT INTO repos (id, repo_url, local_path, branch, default_branch, clone_status, cloned_at)
       VALUES (1, 'https://github.com/test/my-repo', 'repos/my-repo', 'main', 'main', 'ready', ${now})`,
    )

    // Insert a schedule job for the real repo
    db.exec(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (1, 1, 'Real repo job', 1, 'interval', 'Run the real repo job', ${now}, ${now})`,
    )

    // Insert a schedule job for the assistant (repo_id=0)
    db.exec(
      `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
       VALUES (2, 0, 'Assistant job', 1, 'interval', 'Run the assistant job', ${now}, ${now})`,
    )

    // Insert a schedule run for the real repo job
    db.exec(
      `INSERT INTO schedule_runs (id, job_id, repo_id, trigger_source, status, started_at, created_at)
       VALUES (1, 1, 1, 'manual', 'completed', ${now}, ${now})`,
    )

    // Insert a schedule run for the assistant job
    db.exec(
      `INSERT INTO schedule_runs (id, job_id, repo_id, trigger_source, status, started_at, created_at)
       VALUES (2, 2, 0, 'manual', 'completed', ${now}, ${now})`,
    )
  })

  it('listAllScheduleJobsWithRepos includes assistant jobs with synthetic metadata', () => {
    const jobs = listAllScheduleJobsWithRepos(db)
    expect(jobs).toHaveLength(2)

    const assistantJob = jobs.find(j => j.repoId === 0)
    expect(assistantJob).toBeDefined()
    if (assistantJob) {
      expect(assistantJob.repoName).toBe('Assistant')
      expect(assistantJob.repoPath).toBe('assistant')
      expect(assistantJob.repoUrl).toBe('')
      expect(assistantJob.name).toBe('Assistant job')
    }

    const realJob = jobs.find(j => j.repoId === 1)
    expect(realJob).toBeDefined()
    if (realJob) {
      expect(realJob.repoName).toBe('my-repo')
      expect(realJob.repoPath).toBe('repos/my-repo')
      expect(realJob.repoUrl).toBe('https://github.com/test/my-repo')
      expect(realJob.name).toBe('Real repo job')
    }
  })

  it('listAllScheduleRuns includes assistant runs with synthetic metadata', () => {
    const runs = listAllScheduleRuns(db, {})
    expect(runs).toHaveLength(2)

    const assistantRun = runs.find(r => r.repoId === 0)
    expect(assistantRun).toBeDefined()
    if (assistantRun) {
      expect(assistantRun.repoName).toBe('Assistant')
      expect(assistantRun.repoPath).toBe('assistant')
      expect(assistantRun.jobName).toBe('Assistant job')
    }

    const realRun = runs.find(r => r.repoId === 1)
    expect(realRun).toBeDefined()
    if (realRun) {
      expect(realRun.repoName).toBe('my-repo')
      expect(realRun.repoPath).toBe('repos/my-repo')
      expect(realRun.jobName).toBe('Real repo job')
    }
  })

  it('listAllScheduleRuns with repoId=0 filter returns only assistant runs', () => {
    const runs = listAllScheduleRuns(db, { repoId: 0 })
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    expect(run.repoId).toBe(0)
    expect(run.repoName).toBe('Assistant')
    expect(run.repoPath).toBe('assistant')
  })
})
