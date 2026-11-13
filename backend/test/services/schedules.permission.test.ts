import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import { buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'
import type { Repo } from '../../src/types/repo'
import { getScheduleRunById } from '../../src/db/schedules'
import { ScheduleRunRegistry, ScheduleService } from '../../src/services/schedules'
import { assistantMessage, createStubScheduleApi, createStubScheduleClient } from '../helpers/stub-schedule-api'
import { createStubWorktreeManager } from '../helpers/fake-schedule-service'
import { createTestDatabase, seedRepo, seedScheduleJob } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

describe('ScheduleService permission ruleset in session creation', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let job: ScheduleJob
  let runs: ScheduleRunRegistry

  function createStubClient(sessionID: string, agents: string[] = ['build', 'plan']) {
    const stub = createStubScheduleApi({
      sessionID,
      messages: [assistantMessage('', { completed: true })],
      agents,
    })
    return { stub, client: createStubScheduleClient(stub) }
  }

  function createService(client: ReturnType<typeof createStubScheduleClient>) {
    return new ScheduleService(db, client, createStubWorktreeManager(), null, null, runs)
  }

  function updateJob(overrides: Partial<ScheduleJob>): void {
    job = { ...job, ...overrides }
    db.prepare('UPDATE schedule_jobs SET agent_slug = ?, permission_config = ? WHERE id = ?').run(
      job.agentSlug,
      job.permissionConfig ? JSON.stringify(job.permissionConfig) : null,
      job.id,
    )
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-schedule-permission-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'sample-project' })
    job = seedScheduleJob(db, repo.id, {
      name: 'Weekly engineering summary',
      prompt: 'Review the repository and summarize the current state.',
      branch: null,
      intervalMinutes: 60,
    })
    runs = new ScheduleRunRegistry()
  })

  afterEach(async () => {
    await vi.waitFor(() => expect(runs.snapshot(job.id)).toBeNull(), { timeout: 5000 })
    db.close()
    workspace.restore()
  })

  it('sends the default permission ruleset when job.permissionConfig is null', async () => {
    const { stub, client } = createStubClient('ses-perm-1')

    await createService(client).runJob(repo.id, job.id, 'manual')

    expect(stub.api.session.create).toHaveBeenCalledWith({
      title: 'Scheduled: Weekly engineering summary',
      agent: undefined,
      model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
      location: { directory: repo.fullPath },
      permissions: buildSchedulePermissionRuleset(null),
    })
  })

  it('sends the custom permission ruleset when job.permissionConfig is set', async () => {
    const customConfig = { allowExternalDirectory: true, allowQuestions: true, bashDenyPatterns: [] }
    updateJob({ permissionConfig: customConfig })
    const { stub, client } = createStubClient('ses-perm-2')

    await createService(client).runJob(repo.id, job.id, 'manual')

    expect(stub.api.session.create).toHaveBeenCalledWith({
      title: 'Scheduled: Weekly engineering summary',
      agent: undefined,
      model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
      location: { directory: repo.fullPath },
      permissions: buildSchedulePermissionRuleset(customConfig),
    })
  })

  it('preserves the title and agent alongside the permission ruleset', async () => {
    updateJob({ agentSlug: 'my-agent' })
    const { stub, client } = createStubClient('ses-perm-3', ['build', 'my-agent'])

    await createService(client).runJob(repo.id, job.id, 'manual')

    expect(stub.api.session.create).toHaveBeenCalledWith({
      title: 'Scheduled: Weekly engineering summary',
      agent: 'my-agent',
      model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
      location: { directory: repo.fullPath },
      permissions: buildSchedulePermissionRuleset(null),
    })
  })

  it('runs with the default agent when the agent is not available at the run location', async () => {
    updateJob({ agentSlug: 'assistant' })
    const { stub, client } = createStubClient('ses-perm-4', ['build', 'plan'])

    const run = await createService(client).runJob(repo.id, job.id, 'manual')

    expect(stub.api.session.create).toHaveBeenCalledWith(expect.objectContaining({ agent: undefined }))
    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.logText).toContain('Agent: default')
  })
})
