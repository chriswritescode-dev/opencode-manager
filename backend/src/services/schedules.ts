import type { Database } from 'bun:sqlite'
import { Cron } from 'croner'
import {
  type CreateScheduleJobRequest,
  type ScheduleJob,
  type ScheduleRun,
  type ScheduleRunTriggerSource,
  type UpdateScheduleJobRequest,
} from '@opencode-manager/shared/types'
import { getRepoById } from '../db/queries'
import {
  createScheduleJob,
  createScheduleRun,
  deleteScheduleJob,
  getScheduleJobById,
  getRunningScheduleRunByJob,
  getScheduleRunById,
  listEnabledScheduleJobs,
  listScheduleJobsByRepo,
  listRunningScheduleRuns,
  listScheduleRunsByJob,
  updateScheduleJob,
  updateScheduleJobRunState,
  updateScheduleRun,
  updateScheduleRunMetadata,
} from '../db/schedules'
import {
  buildCreateSchedulePersistenceInput,
  buildUpdatedSchedulePersistenceInput,
  computeNextRunAtForJob,
} from './schedule-config'
import { resolveOpenCodeModel } from './opencode-models'
import { proxyToOpenCodeWithDirectory } from './proxy'
import { sseAggregator, type SSEEvent } from './sse-aggregator'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

class ScheduleServiceError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface SessionResponse {
  id: string
}

interface PromptResponse {
  parts?: Array<{
    type?: string
    text?: string
  }>
}

interface SessionMessagePart {
  type?: string
  text?: string
}

interface SessionMessage {
  info?: {
    id?: string
    sessionID?: string
    role?: string
    time?: {
      created?: number
      completed?: number
    }
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }
  parts?: SessionMessagePart[]
}

interface SessionStatus {
  type: 'idle' | 'retry' | 'busy'
  attempt?: number
  message?: string
  next?: number
}

const RUN_POLL_INTERVAL_MS = 2_000
const RUN_POLL_TIMEOUT_MS = 5 * 60_000

interface SessionMonitor {
  getErrorText(): string | null
  isIdle(): boolean
  dispose(): void
}

function extractResponseText(response: PromptResponse): string {
  return (response.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function buildSessionTitle(job: ScheduleJob): string {
  return `Scheduled: ${job.name}`
}

function buildRunLog(input: {
  job: ScheduleJob
  triggerSource: ScheduleRunTriggerSource
  sessionId?: string | null
  sessionTitle?: string | null
  responseText?: string | null
  errorText?: string | null
  finishedAt: number
}): string {
  const scheduleLabel = input.job.scheduleMode === 'cron'
    ? `${input.job.cronExpression ?? ''} (${input.job.timezone ?? 'UTC'})`
    : `every ${input.job.intervalMinutes ?? 0} minutes`

  const lines = [
    `Job: ${input.job.name}`,
    `Trigger: ${input.triggerSource}`,
    `Finished: ${new Date(input.finishedAt).toISOString()}`,
    `Agent: ${input.job.agentSlug ?? 'default'}`,
    `Schedule: ${scheduleLabel}`,
  ]

  if (input.sessionId) {
    lines.push(`Session ID: ${input.sessionId}`)
  }

  if (input.sessionTitle) {
    lines.push(`Session title: ${input.sessionTitle}`)
  }

  if (input.errorText) {
    lines.push('', 'Error:', input.errorText)
  }

  if (input.responseText) {
    lines.push('', 'Assistant output:', input.responseText)
  }

  return lines.join('\n')
}

function buildRunStartedLog(input: {
  job: ScheduleJob
  triggerSource: ScheduleRunTriggerSource
  sessionId: string
  sessionTitle: string
}): string {
  const scheduleLabel = input.job.scheduleMode === 'cron'
    ? `${input.job.cronExpression ?? ''} (${input.job.timezone ?? 'UTC'})`
    : `every ${input.job.intervalMinutes ?? 0} minutes`

  return [
    `Job: ${input.job.name}`,
    `Trigger: ${input.triggerSource}`,
    `Started: ${new Date().toISOString()}`,
    `Agent: ${input.job.agentSlug ?? 'default'}`,
    `Schedule: ${scheduleLabel}`,
    `Session ID: ${input.sessionId}`,
    `Session title: ${input.sessionTitle}`,
    '',
    'Run started. Waiting for assistant response...',
  ].join('\n')
}

function parsePromptResponse(responseText: string): PromptResponse | null {
  if (!responseText.trim()) {
    return null
  }

  try {
    return JSON.parse(responseText) as PromptResponse
  } catch {
    return null
  }
}

function extractAssistantMessageText(parts: SessionMessagePart[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function getAssistantMessageState(messages: SessionMessage[]): {
  responseText: string | null
  errorText: string | null
  completed: boolean
} | null {
  const assistantMessage = [...messages]
    .reverse()
    .find((message) => message.info?.role === 'assistant')

  if (!assistantMessage) {
    return null
  }

  return {
    responseText: extractAssistantMessageText(assistantMessage.parts) || null,
    errorText: assistantMessage.info?.error?.data?.message ?? assistantMessage.info?.error?.name ?? null,
    completed: Boolean(assistantMessage.info?.time?.completed),
  }
}

function getSessionEventId(event: SSEEvent): string | null {
  const properties = event.properties as {
    sessionID?: string
    info?: { id?: string }
  }

  return properties.sessionID ?? properties.info?.id ?? null
}

function getSessionErrorText(event: SSEEvent): string | null {
  const properties = event.properties as {
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }

  return properties.error?.data?.message ?? properties.error?.name ?? null
}

function getSessionStatusType(event: SSEEvent): string | null {
  const properties = event.properties as {
    status?: {
      type?: string
    }
  }

  return properties.status?.type ?? null
}

function createSessionMonitor(directory: string, sessionId: string): SessionMonitor {
  const clientId = `schedule-monitor-${sessionId}-${Date.now()}`
  let errorText: string | null = null
  let idle = false

  const removeClient = sseAggregator.addClient(clientId, () => {}, [directory])
  const unsubscribe = sseAggregator.onEvent((eventDirectory, event) => {
    if (eventDirectory !== directory) {
      return
    }

    if (getSessionEventId(event) !== sessionId) {
      return
    }

    if (event.type === 'session.error') {
      errorText = getSessionErrorText(event) ?? 'The session reported an unknown error.'
      return
    }

    if (event.type === 'session.idle') {
      idle = true
      return
    }

    if (event.type === 'session.status' && getSessionStatusType(event) === 'idle') {
      idle = true
    }
  })

  return {
    getErrorText: () => errorText,
    isIdle: () => idle,
    dispose: () => {
      unsubscribe()
      removeClient()
    },
  }
}

export class ScheduleService {
  private static activeRuns = new Set<number>()
  private onJobChange: ((job: ScheduleJob | null, jobId: number) => void) | null = null

  constructor(private readonly db: Database) {}

  setJobChangeHandler(handler: ((job: ScheduleJob | null, jobId: number) => void) | null): void {
    this.onJobChange = handler
  }

  listAllEnabledJobs(): ScheduleJob[] {
    return listEnabledScheduleJobs(this.db)
  }

  async recoverRunningRuns(): Promise<void> {
    const runningRuns = listRunningScheduleRuns(this.db)

    for (const run of runningRuns) {
      const job = getScheduleJobById(this.db, run.repoId, run.jobId)
      if (!job) {
        continue
      }

      if (ScheduleService.activeRuns.has(job.id)) {
        continue
      }

      ScheduleService.activeRuns.add(job.id)
      await this.recoverRunningRun(job, run)
    }
  }

  listJobs(repoId: number): ScheduleJob[] {
    this.assertRepo(repoId)
    return listScheduleJobsByRepo(this.db, repoId)
  }

  getJob(repoId: number, jobId: number): ScheduleJob | null {
    return getScheduleJobById(this.db, repoId, jobId)
  }

  createJob(repoId: number, input: CreateScheduleJobRequest): ScheduleJob {
    this.assertRepo(repoId)

    try {
      const job = createScheduleJob(this.db, repoId, buildCreateSchedulePersistenceInput(input))
      this.onJobChange?.(job, job.id)
      return job
    } catch (error) {
      throw new ScheduleServiceError(getErrorMessage(error), 400)
    }
  }

  updateJob(repoId: number, jobId: number, input: UpdateScheduleJobRequest): ScheduleJob {
    this.assertRepo(repoId)
    const existing = this.assertJob(repoId, jobId)
    let job: ScheduleJob | null

    try {
      job = updateScheduleJob(this.db, repoId, jobId, buildUpdatedSchedulePersistenceInput(existing, input))
    } catch (error) {
      throw new ScheduleServiceError(getErrorMessage(error), 400)
    }

    if (!job) {
      throw new ScheduleServiceError('Schedule not found', 404)
    }
    this.onJobChange?.(job, job.id)
    return job
  }

  deleteJob(repoId: number, jobId: number): void {
    this.assertRepo(repoId)
    const deleted = deleteScheduleJob(this.db, repoId, jobId)
    if (!deleted) {
      throw new ScheduleServiceError('Schedule not found', 404)
    }
    this.onJobChange?.(null, jobId)
  }

  listRuns(repoId: number, jobId: number, limit: number = 20): ScheduleRun[] {
    this.assertJob(repoId, jobId)
    return listScheduleRunsByJob(this.db, repoId, jobId, limit)
  }

  getRun(repoId: number, jobId: number, runId: number): ScheduleRun {
    this.assertJob(repoId, jobId)
    const run = getScheduleRunById(this.db, repoId, jobId, runId)
    if (!run) {
      throw new ScheduleServiceError('Run not found', 404)
    }
    return run
  }

  async runJob(repoId: number, jobId: number, triggerSource: ScheduleRunTriggerSource): Promise<ScheduleRun> {
    const repo = this.assertRepo(repoId)
    const job = this.assertJob(repoId, jobId)

    const existingRunningRun = getRunningScheduleRunByJob(this.db, repoId, jobId)
    if (existingRunningRun) {
      throw new ScheduleServiceError('Schedule is already running', 409)
    }

    if (ScheduleService.activeRuns.has(jobId)) {
      throw new ScheduleServiceError('Schedule is already running', 409)
    }

    ScheduleService.activeRuns.add(jobId)

    const startedAt = Date.now()
    const run = createScheduleRun(this.db, {
      jobId,
      repoId,
      triggerSource,
      status: 'running',
      startedAt,
      createdAt: startedAt,
    })

    try {
      const model = await resolveOpenCodeModel(repo.fullPath, {
        preferredModel: job.model,
      })
      const sessionTitle = buildSessionTitle(job)
      const sessionResponse = await proxyToOpenCodeWithDirectory(
        '/session',
        'POST',
        repo.fullPath,
        JSON.stringify({
          title: sessionTitle,
          agent: job.agentSlug ?? undefined,
        }),
      )

      if (!sessionResponse.ok) {
        throw new ScheduleServiceError('Failed to create OpenCode session', 502)
      }

      const session = await sessionResponse.json() as SessionResponse
      const runWithSession = updateScheduleRunMetadata(this.db, repoId, jobId, run.id, {
        sessionId: session.id,
        sessionTitle,
        logText: buildRunStartedLog({
          job,
          triggerSource,
          sessionId: session.id,
          sessionTitle,
        }),
      })

      if (!runWithSession) {
        throw new ScheduleServiceError('Failed to attach session to run', 500)
      }

      const sessionMonitor = createSessionMonitor(repo.fullPath, session.id)

      void this.submitPromptAndMonitor({
        repoId,
        job,
        runId: run.id,
        sessionId: session.id,
        sessionTitle,
        triggerSource,
        model,
        sessionMonitor,
      })

      return runWithSession
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to run schedule ${jobId}:`, error)

      const failedRun = updateScheduleRun(this.db, repoId, jobId, run.id, {
        status: 'failed',
        finishedAt,
        errorText,
        logText: buildRunLog({
          job,
          triggerSource,
          errorText,
          finishedAt,
        }),
      })

      try {
        updateScheduleJobRunState(this.db, repoId, jobId, {
          lastRunAt: finishedAt,
          nextRunAt: triggerSource === 'manual' ? job.nextRunAt : computeNextRunAtForJob(job, finishedAt),
        })
      } catch (updateError) {
        logger.error(`Failed to update job state for job ${jobId}:`, updateError)
      }

      if (!failedRun) {
        ScheduleService.activeRuns.delete(jobId)
        throw new ScheduleServiceError('Failed to load failed run', 500)
      }

      if (error instanceof ScheduleServiceError) {
        ScheduleService.activeRuns.delete(jobId)
        throw error
      }

      ScheduleService.activeRuns.delete(jobId)
      throw new ScheduleServiceError(errorText, 500)
    }
  }

  async cancelRun(repoId: number, jobId: number, runId: number): Promise<ScheduleRun> {
    const repo = this.assertRepo(repoId)
    const job = this.assertJob(repoId, jobId)
    const run = this.getRun(repoId, jobId, runId)

    if (run.status !== 'running') {
      throw new ScheduleServiceError('Only running schedule runs can be cancelled', 409)
    }

    if (run.sessionId) {
      const messages = await this.listSessionMessages(repo.fullPath, run.sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState?.completed || assistantState?.errorText) {
        this.finalizeRecoveredRun(job, run, {
          status: assistantState.errorText ? 'failed' : 'completed',
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        })

        return this.getRun(repoId, jobId, runId)
      }

      const abortResponse = await proxyToOpenCodeWithDirectory(
        `/session/${run.sessionId}/abort`,
        'POST',
        repo.fullPath,
      )

      if (!abortResponse.ok) {
        const errorText = await abortResponse.text()
        throw new ScheduleServiceError(errorText || 'Failed to cancel schedule run', 502)
      }
    }

    const finishedAt = Date.now()
    const cancellationMessage = 'Run cancelled by user.'
    const cancelledRun = updateScheduleRun(this.db, repoId, jobId, runId, {
      status: 'cancelled',
      finishedAt,
      sessionId: run.sessionId,
      sessionTitle: run.sessionTitle,
      errorText: cancellationMessage,
      responseText: run.responseText,
      logText: buildRunLog({
        job,
        triggerSource: run.triggerSource,
        sessionId: run.sessionId,
        sessionTitle: run.sessionTitle,
        responseText: run.responseText,
        errorText: cancellationMessage,
        finishedAt,
      }),
    })

    updateScheduleJobRunState(this.db, repoId, jobId, {
      lastRunAt: finishedAt,
      nextRunAt: job.nextRunAt,
    })

    ScheduleService.activeRuns.delete(jobId)

    if (!cancelledRun) {
      throw new ScheduleServiceError('Failed to update cancelled run', 500)
    }

    return cancelledRun
  }

  private async submitPromptAndMonitor(input: {
    repoId: number
    job: ScheduleJob
    runId: number
    sessionId: string
    sessionTitle: string
    triggerSource: ScheduleRunTriggerSource
    model: { providerID: string; modelID: string }
    sessionMonitor: SessionMonitor
  }): Promise<void> {
    const repo = this.assertRepo(input.repoId)

    try {
      const promptResponse = await proxyToOpenCodeWithDirectory(
        `/session/${input.sessionId}/message`,
        'POST',
        repo.fullPath,
        JSON.stringify({
          parts: [{ type: 'text', text: input.job.prompt }],
          model: input.model,
        }),
      )

      if (!promptResponse.ok) {
        const errorText = await promptResponse.text()
        throw new ScheduleServiceError(errorText || 'Failed to run scheduled prompt', 502)
      }

      const promptBody = await promptResponse.text()
      const promptResult = parsePromptResponse(promptBody)

      if (promptResult) {
        const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
        if (!currentRun || currentRun.status !== 'running') {
          return
        }

        const finishedAt = Date.now()
        const responseText = extractResponseText(promptResult)
        updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'completed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText,
            finishedAt,
          }),
        })

        updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
          lastRunAt: finishedAt,
          nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
        })

        return
      }

      await this.monitorRunCompletion({
        sessionMonitor: input.sessionMonitor,
        repoId: input.repoId,
        job: input.job,
        runId: input.runId,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        triggerSource: input.triggerSource,
      })
      return
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to submit prompt for schedule ${input.job.id}:`, error)

      const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
        status: 'failed',
        finishedAt,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        errorText,
        logText: buildRunLog({
          job: input.job,
          triggerSource: input.triggerSource,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText,
          finishedAt,
        }),
      })

      updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } finally {
      input.sessionMonitor.dispose()
      ScheduleService.activeRuns.delete(input.job.id)
    }
  }

  private async monitorRunCompletion(input: {
    sessionMonitor: SessionMonitor
    repoId: number
    job: ScheduleJob
    runId: number
    sessionId: string
    sessionTitle: string
    triggerSource: ScheduleRunTriggerSource
    initialSessionStatus?: SessionStatus
  }): Promise<void> {
    try {
      const sessionStatus = input.initialSessionStatus
      if (sessionStatus && sessionStatus.type === 'idle') {
        const repo = this.assertRepo(input.repoId)
        const messages = await this.listSessionMessages(repo.fullPath, input.sessionId)
        const assistantState = getAssistantMessageState(messages)
        if (assistantState?.completed || assistantState?.errorText) {
          this.finalizeRecoveredRun(input.job, {
            id: input.runId,
            repoId: input.repoId,
            jobId: input.job.id,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            triggerSource: input.triggerSource,
          } as ScheduleRun, {
            status: assistantState.errorText ? 'failed' : 'completed',
            responseText: assistantState.responseText,
            errorText: assistantState.errorText,
          })
          return
        }
      }

      const repo = this.assertRepo(input.repoId)
      const currentMessages = await this.listSessionMessages(repo.fullPath, input.sessionId)
      const currentAssistantState = getAssistantMessageState(currentMessages)
      if (currentAssistantState?.completed || currentAssistantState?.errorText) {
        this.finalizeRecoveredRun(input.job, {
          id: input.runId,
          repoId: input.repoId,
          jobId: input.job.id,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          triggerSource: input.triggerSource,
        } as ScheduleRun, {
          status: currentAssistantState.errorText ? 'failed' : 'completed',
          responseText: currentAssistantState.responseText,
          errorText: currentAssistantState.errorText,
        })
        return
      }

      const response = await this.waitForAssistantMessage(input.job, input.sessionId, input.sessionMonitor)
      const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      const finishedAt = Date.now()

      if (response.errorText) {
        updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'failed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText: response.errorText,
          responseText: response.responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText: response.responseText,
            errorText: response.errorText,
            finishedAt,
          }),
        })
      } else {
        updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'completed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          responseText: response.responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText: response.responseText,
            finishedAt,
          }),
        })
      }

      updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to monitor schedule ${input.job.id}:`, error)

      const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
        status: 'failed',
        finishedAt,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        errorText,
        logText: buildRunLog({
          job: input.job,
          triggerSource: input.triggerSource,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText,
          finishedAt,
        }),
      })

      updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } finally {
      input.sessionMonitor.dispose()
      ScheduleService.activeRuns.delete(input.job.id)
    }
  }

  private async recoverRunningRun(job: ScheduleJob, run: ScheduleRun): Promise<void> {
    try {
      const repo = this.assertRepo(job.repoId)

      if (!run.sessionId) {
        this.finalizeRecoveredRun(job, run, {
          status: 'failed',
          errorText: 'This run was interrupted before completion and had no linked session to recover.',
        })
        return
      }

      const messages = await this.listSessionMessages(repo.fullPath, run.sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState?.completed || assistantState?.errorText) {
        this.finalizeRecoveredRun(job, run, {
          status: assistantState.errorText ? 'failed' : 'completed',
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        })
        return
      }

      const sessionStatuses = await this.getSessionStatuses(repo.fullPath)
      const sessionStatus = run.sessionId ? sessionStatuses[run.sessionId] : undefined

      if (sessionStatus && sessionStatus.type !== 'idle') {
        const sessionMonitor = createSessionMonitor(repo.fullPath, run.sessionId)
        void this.monitorRunCompletion({
          sessionMonitor,
          repoId: run.repoId,
          job,
          runId: run.id,
          sessionId: run.sessionId,
          sessionTitle: run.sessionTitle ?? buildSessionTitle(job),
          triggerSource: run.triggerSource,
          initialSessionStatus: sessionStatus,
        })
        return
      }

      this.finalizeRecoveredRun(job, run, {
        status: 'failed',
        responseText: assistantState?.responseText ?? null,
        errorText: 'This run was interrupted before completion, likely because OpenCode Manager restarted while it was in progress. Open the linked session to inspect the partial output and rerun if needed.',
      })
    } catch (error) {
      const errorText = getErrorMessage(error)
      logger.error(`Failed to recover schedule ${job.id}:`, error)
      this.finalizeRecoveredRun(job, run, {
        status: 'failed',
        errorText,
      })
    }
  }

  private finalizeRecoveredRun(
    job: ScheduleJob,
    run: ScheduleRun,
    input: {
      status: 'completed' | 'failed'
      responseText?: string | null
      errorText?: string | null
    },
  ): void {
    const finishedAt = Date.now()

    updateScheduleRun(this.db, run.repoId, run.jobId, run.id, {
      status: input.status,
      finishedAt,
      sessionId: run.sessionId,
      sessionTitle: run.sessionTitle,
      responseText: input.responseText,
      errorText: input.errorText,
      logText: buildRunLog({
        job,
        triggerSource: run.triggerSource,
        sessionId: run.sessionId,
        sessionTitle: run.sessionTitle,
        responseText: input.responseText,
        errorText: input.errorText,
        finishedAt,
      }),
    })

    updateScheduleJobRunState(this.db, run.repoId, run.jobId, {
      lastRunAt: finishedAt,
      nextRunAt: run.triggerSource === 'manual' ? job.nextRunAt : computeNextRunAtForJob(job, finishedAt),
    })

    ScheduleService.activeRuns.delete(job.id)
  }

  private async waitForAssistantMessage(
    job: ScheduleJob,
    sessionId: string,
    sessionMonitor: SessionMonitor,
  ): Promise<{ responseText: string | null; errorText: string | null }> {
    const startedAt = Date.now()
    const repo = this.assertRepo(job.repoId)

    while (Date.now() - startedAt < RUN_POLL_TIMEOUT_MS) {
      const messages = await this.listSessionMessages(repo.fullPath, sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState && (assistantState.completed || assistantState.errorText)) {
        return {
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        }
      }

      const sessionErrorText = sessionMonitor.getErrorText()
      if (sessionErrorText) {
        return {
          responseText: null,
          errorText: sessionErrorText,
        }
      }

      if (sessionMonitor.isIdle()) {
        return {
          responseText: null,
          errorText: 'The session became idle without producing an assistant response. Open the linked session to inspect any pending questions, permissions, or provider issues.',
        }
      }

      await Bun.sleep(RUN_POLL_INTERVAL_MS)
    }

    return {
      responseText: null,
      errorText: 'Timed out waiting for the assistant response. Open the linked session to inspect any pending questions, permissions, or provider issues.',
    }
  }

  private async listSessionMessages(directory: string, sessionId: string): Promise<SessionMessage[]> {
    const messagesResponse = await proxyToOpenCodeWithDirectory(
      `/session/${sessionId}/message`,
      'GET',
      directory,
    )

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text()
      throw new ScheduleServiceError(errorText || 'Failed to fetch session messages', 502)
    }

    return await messagesResponse.json() as SessionMessage[]
  }

  private async getSessionStatuses(directory: string): Promise<Record<string, SessionStatus>> {
    const response = await proxyToOpenCodeWithDirectory('/session/status', 'GET', directory)

    if (!response.ok) {
      const errorText = await response.text()
      throw new ScheduleServiceError(errorText || 'Failed to fetch session statuses', 502)
    }

    return await response.json() as Record<string, SessionStatus>
  }

  private assertRepo(repoId: number) {
    const repo = getRepoById(this.db, repoId)
    if (!repo) {
      throw new ScheduleServiceError('Repo not found', 404)
    }
    return repo
  }

  private assertJob(repoId: number, jobId: number) {
    const job = getScheduleJobById(this.db, repoId, jobId)
    if (!job) {
      throw new ScheduleServiceError('Schedule not found', 404)
    }
    return job
  }
}

export class ScheduleRunner {
  private cronJobs = new Map<number, Cron>()

  constructor(private readonly scheduleService: ScheduleService) {}

  async start(): Promise<void> {
    this.scheduleService.setJobChangeHandler((job, jobId) => {
      if (job) {
        this.registerJob(job)
      } else {
        this.unregisterJob(jobId)
      }
    })

    await this.scheduleService.recoverRunningRuns()
    this.registerAllEnabledJobs()
  }

  stop(): void {
    this.scheduleService.setJobChangeHandler(null as never)
    for (const cron of this.cronJobs.values()) {
      cron.stop()
    }
    this.cronJobs.clear()
  }

  registerJob(job: ScheduleJob): void {
    this.unregisterJob(job.id)

    if (!job.enabled) {
      return
    }

    if (job.scheduleMode === 'cron') {
      if (!job.cronExpression) {
        return
      }
      const options: Record<string, unknown> = { protect: true }
      if (job.timezone) {
        options.timezone = job.timezone
      }
      const cron = new Cron(job.cronExpression, options, () => {
        logger.info(`Cron triggered for job ${job.id}: ${job.name}`)
        void this.executeJob(job.repoId, job.id)
      })
      this.cronJobs.set(job.id, cron)
      logger.info(`Cron job created for ${job.id}: next run at ${cron.nextRun()?.toISOString()}`)
      return
    }

    if (!job.intervalMinutes) {
      return
    }

    if (!job.nextRunAt) {
      return
    }

    const cronExpression = `*/${job.intervalMinutes} * * * *`
    const options: Record<string, unknown> = { protect: true }
    if (job.timezone) {
      options.timezone = job.timezone
    }
    const cron = new Cron(cronExpression, options, () => {
      logger.info(`Cron triggered for job ${job.id}: ${job.name}`)
      void this.executeJob(job.repoId, job.id)
    })

    const now = Date.now()
    const delay = job.nextRunAt - now
    if (delay > 0) {
      const timeout = setTimeout(() => {
        logger.info(`Interval timer triggered for job ${job.id}: ${job.name}`)
        void this.executeJob(job.repoId, job.id)
        this.cronJobs.set(job.id, cron)
      }, delay)
      this.cronJobs.set(job.id, { stop: () => clearTimeout(timeout) } as unknown as Cron)
    } else {
      this.cronJobs.set(job.id, cron)
    }
  }

  unregisterJob(jobId: number): void {
    const existing = this.cronJobs.get(jobId)
    if (existing) {
      existing.stop()
      this.cronJobs.delete(jobId)
    }
  }

  private async executeJob(repoId: number, jobId: number): Promise<void> {
    try {
      await this.scheduleService.runJob(repoId, jobId, 'schedule')
    } catch (error) {
      logger.error(`Scheduled run failed for job ${jobId}:`, error)
    }
  }

  private registerAllEnabledJobs(): void {
    const jobs = this.scheduleService.listAllEnabledJobs()
    logger.info(`Registering ${jobs.length} enabled schedule jobs`)
    for (const job of jobs) {
      try {
        logger.info(`Registering job ${job.id}: ${job.name} (mode=${job.scheduleMode}, cron=${job.cronExpression}, tz=${job.timezone})`)
        this.registerJob(job)
        logger.info(`Job ${job.id} registered, cron jobs map size: ${this.cronJobs.size}`)
      } catch (error) {
        logger.error(`Failed to register job ${job.id}:`, error)
      }
    }
  }
}

export { ScheduleServiceError }
