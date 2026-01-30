import { Database } from 'bun:sqlite'
import cron, { ScheduledTask } from 'node-cron'
import { spawn } from 'child_process'
import { logger } from '../utils/logger'

export interface ScheduledTaskRecord {
  id: number
  name: string
  schedule_type: string
  schedule_value: string
  command_type: string
  command_config: string
  status: 'active' | 'paused'
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export interface CommandConfig {
  command?: string
  args?: string[]
  workdir?: string
  skillName?: string
  message?: string
}

export interface CreateTaskInput {
  name: string
  schedule_type: 'cron'
  schedule_value: string
  command_type: 'skill' | 'opencode-run' | 'script'
  command_config: CommandConfig
}

export interface UpdateTaskInput {
  name?: string
  schedule_value?: string
  command_type?: 'skill' | 'opencode-run' | 'script'
  command_config?: CommandConfig
}

export interface TaskRunResult {
  success: boolean
  output: string
  error?: string
  duration: number
}

class SchedulerService {
  private db: Database | null = null
  private jobs: Map<number, ScheduledTask> = new Map()

  setDatabase(db: Database): void {
    this.db = db
  }

  async initialize(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not set')
    }

    const tasks = this.getAllTasks().filter(t => t.status === 'active')
    logger.info(`Loading ${tasks.length} active scheduled tasks`)

    for (const task of tasks) {
      this.scheduleTask(task)
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Stopping all scheduled tasks')
    for (const [taskId, job] of this.jobs) {
      job.stop()
      logger.debug(`Stopped task ${taskId}`)
    }
    this.jobs.clear()
  }

  getAllTasks(): ScheduledTaskRecord[] {
    if (!this.db) return []
    
    const stmt = this.db.prepare(`
      SELECT * FROM scheduled_tasks ORDER BY created_at DESC
    `)
    return stmt.all() as ScheduledTaskRecord[]
  }

  getTask(id: number): ScheduledTaskRecord | null {
    if (!this.db) return null
    
    const stmt = this.db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`)
    return stmt.get(id) as ScheduledTaskRecord | null
  }

  createTask(input: CreateTaskInput): ScheduledTaskRecord {
    if (!this.db) {
      throw new Error('Database not set')
    }

    if (!cron.validate(input.schedule_value)) {
      throw new Error(`Invalid cron expression: ${input.schedule_value}`)
    }

    const now = Date.now()
    const nextRun = this.calculateNextRun(input.schedule_value)

    const stmt = this.db.prepare(`
      INSERT INTO scheduled_tasks 
      (name, schedule_type, schedule_value, command_type, command_config, status, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `)

    const result = stmt.run(
      input.name,
      input.schedule_type,
      input.schedule_value,
      input.command_type,
      JSON.stringify(input.command_config),
      nextRun,
      now,
      now
    )

    const task = this.getTask(Number(result.lastInsertRowid))!
    this.scheduleTask(task)
    logger.info(`Created scheduled task: ${task.name} (id=${task.id})`)
    
    return task
  }

  updateTask(id: number, input: UpdateTaskInput): ScheduledTaskRecord | null {
    if (!this.db) return null

    const existing = this.getTask(id)
    if (!existing) return null

    if (input.schedule_value && !cron.validate(input.schedule_value)) {
      throw new Error(`Invalid cron expression: ${input.schedule_value}`)
    }

    const updates: string[] = []
    const values: (string | number)[] = []

    if (input.name !== undefined) {
      updates.push('name = ?')
      values.push(input.name)
    }
    if (input.schedule_value !== undefined) {
      updates.push('schedule_value = ?')
      values.push(input.schedule_value)
      updates.push('next_run_at = ?')
      values.push(this.calculateNextRun(input.schedule_value))
    }
    if (input.command_type !== undefined) {
      updates.push('command_type = ?')
      values.push(input.command_type)
    }
    if (input.command_config !== undefined) {
      updates.push('command_config = ?')
      values.push(JSON.stringify(input.command_config))
    }

    if (updates.length === 0) return existing

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?
    `)
    stmt.run(...values)

    const updated = this.getTask(id)!
    
    if (updated.status === 'active') {
      this.unscheduleTask(id)
      this.scheduleTask(updated)
    }

    logger.info(`Updated scheduled task: ${updated.name} (id=${id})`)
    return updated
  }

  deleteTask(id: number): boolean {
    if (!this.db) return false

    this.unscheduleTask(id)

    const stmt = this.db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`)
    const result = stmt.run(id)
    
    logger.info(`Deleted scheduled task id=${id}`)
    return result.changes > 0
  }

  toggleTask(id: number): ScheduledTaskRecord | null {
    if (!this.db) return null

    const task = this.getTask(id)
    if (!task) return null

    const newStatus = task.status === 'active' ? 'paused' : 'active'
    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks SET status = ?, updated_at = ? WHERE id = ?
    `)
    stmt.run(newStatus, Date.now(), id)

    if (newStatus === 'paused') {
      this.unscheduleTask(id)
    } else {
      const updated = this.getTask(id)!
      this.scheduleTask(updated)
    }

    logger.info(`Toggled task ${id} to ${newStatus}`)
    return this.getTask(id)
  }

  async runTaskNow(id: number): Promise<TaskRunResult> {
    const task = this.getTask(id)
    if (!task) {
      return { success: false, output: '', error: 'Task not found', duration: 0 }
    }

    return this.executeTask(task)
  }

  private scheduleTask(task: ScheduledTaskRecord): void {
    if (this.jobs.has(task.id)) {
      this.unscheduleTask(task.id)
    }

    const job = cron.schedule(task.schedule_value, async () => {
      logger.info(`Executing scheduled task: ${task.name} (id=${task.id})`)
      const result = await this.executeTask(task)
      
      if (result.success) {
        logger.info(`Task ${task.id} completed successfully in ${result.duration}ms`)
      } else {
        logger.error(`Task ${task.id} failed: ${result.error}`)
      }
    }, {
      scheduled: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })

    this.jobs.set(task.id, job)
    logger.debug(`Scheduled task ${task.id}: ${task.schedule_value}`)
  }

  private unscheduleTask(id: number): void {
    const job = this.jobs.get(id)
    if (job) {
      job.stop()
      this.jobs.delete(id)
      logger.debug(`Unscheduled task ${id}`)
    }
  }

  private async executeTask(task: ScheduledTaskRecord): Promise<TaskRunResult> {
    const startTime = Date.now()
    const config: CommandConfig = JSON.parse(task.command_config)

    try {
      let result: TaskRunResult

      switch (task.command_type) {
        case 'skill':
          result = await this.runSkill(config)
          break
        case 'opencode-run':
          result = await this.runOpencodeCommand(config)
          break
        case 'script':
          result = await this.runScript(config)
          break
        default:
          throw new Error(`Unknown command type: ${task.command_type}`)
      }

      this.updateLastRun(task.id, startTime)
      return { ...result, duration: Date.now() - startTime }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateLastRun(task.id, startTime)
      return {
        success: false,
        output: '',
        error: errorMessage,
        duration: Date.now() - startTime
      }
    }
  }

  private async runSkill(config: CommandConfig): Promise<TaskRunResult> {
    const { skillName, args = [], workdir } = config
    if (!skillName) {
      throw new Error('Skill name is required')
    }

    const command = `/${skillName} ${args.join(' ')}`.trim()
    return this.runOpencodeCommand({ command, workdir })
  }

  private async runOpencodeCommand(config: CommandConfig): Promise<TaskRunResult> {
    const { command, message, workdir } = config
    
    const args = ['run']
    if (command) {
      args.push('--command', command)
    }
    if (message) {
      args.push(message)
    }

    return this.spawnProcess('opencode', args, workdir)
  }

  private async runScript(config: CommandConfig): Promise<TaskRunResult> {
    const { command, args = [], workdir } = config
    if (!command) {
      throw new Error('Command is required for script type')
    }

    return this.spawnProcess(command, args, workdir)
  }

  private spawnProcess(cmd: string, args: string[], workdir?: string): Promise<TaskRunResult> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      const errorChunks: Buffer[] = []

      const proc = spawn(cmd, args, {
        cwd: workdir || process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      proc.stdout?.on('data', (data) => chunks.push(data))
      proc.stderr?.on('data', (data) => errorChunks.push(data))

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: Buffer.concat(chunks).toString(),
          error: 'Task timed out after 5 minutes',
          duration: 300000
        })
      }, 300000)

      proc.on('close', (code) => {
        clearTimeout(timeout)
        const output = Buffer.concat(chunks).toString()
        const stderr = Buffer.concat(errorChunks).toString()
        
        resolve({
          success: code === 0,
          output: output + (stderr ? `\nStderr: ${stderr}` : ''),
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
          duration: 0
        })
      })

      proc.on('error', (error) => {
        clearTimeout(timeout)
        resolve({
          success: false,
          output: '',
          error: error.message,
          duration: 0
        })
      })
    })
  }

  private updateLastRun(id: number, timestamp: number): void {
    if (!this.db) return

    const task = this.getTask(id)
    if (!task) return

    const nextRun = this.calculateNextRun(task.schedule_value)
    
    const stmt = this.db.prepare(`
      UPDATE scheduled_tasks 
      SET last_run_at = ?, next_run_at = ?, updated_at = ? 
      WHERE id = ?
    `)
    stmt.run(timestamp, nextRun, Date.now(), id)
  }

  private calculateNextRun(cronExpression: string): number {
    const interval = cron.schedule(cronExpression, () => {}, { scheduled: false })
    
    const now = new Date()
    const parts = cronExpression.split(' ')
    
    const minute = parts[0] === '*' ? now.getMinutes() : parseInt(parts[0]) || 0
    const hour = parts[1] === '*' ? now.getHours() : parseInt(parts[1]) || 0
    const dayOfMonth = parts[2] === '*' ? now.getDate() : parseInt(parts[2]) || 1
    const month = parts[3] === '*' ? now.getMonth() : (parseInt(parts[3]) || 1) - 1
    
    let nextDate = new Date(now.getFullYear(), month, dayOfMonth, hour, minute, 0, 0)
    
    if (nextDate <= now) {
      if (parts[0] !== '*') {
        nextDate.setHours(nextDate.getHours() + 1)
      } else if (parts[1] !== '*') {
        nextDate.setDate(nextDate.getDate() + 1)
      } else {
        nextDate.setMinutes(nextDate.getMinutes() + 1)
      }
    }
    
    interval.stop()
    return nextDate.getTime()
  }
}

export const schedulerService = new SchedulerService()
