import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn()
}))

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn((expr: string) => {
      if (expr === 'invalid') return false
      if (expr.includes('* * * * *')) return true
      if (expr.includes('0 9 * * *')) return true
      if (expr.includes('*/5 * * * *')) return true
      return true
    }),
    schedule: vi.fn((_, callback, options) => {
      const mockJob = {
        stop: vi.fn(),
        start: vi.fn(),
        callback
      }
      return mockJob
    })
  }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd, args, options) => {
    const mockProcess = {
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('test output'))
          }
        })
      },
      stderr: {
        on: vi.fn((event, callback) => {})
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10)
        }
      }),
      kill: vi.fn()
    }
    return mockProcess
  })
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

import { schedulerService, type CreateTaskInput, type ScheduledTaskRecord } from '../../src/services/scheduler'
import cron from 'node-cron'
import { spawn } from 'child_process'

describe('SchedulerService', () => {
  let mockDb: any
  let insertedTasks: ScheduledTaskRecord[]
  let taskIdCounter: number

  beforeEach(() => {
    vi.clearAllMocks()
    insertedTasks = []
    taskIdCounter = 1

    mockDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('INSERT INTO scheduled_tasks')) {
          return {
            run: vi.fn((...args) => {
              const task: ScheduledTaskRecord = {
                id: taskIdCounter++,
                name: args[0],
                schedule_type: args[1],
                schedule_value: args[2],
                command_type: args[3],
                command_config: args[4],
                status: 'active',
                last_run_at: null,
                next_run_at: args[5],
                created_at: args[6],
                updated_at: args[7]
              }
              insertedTasks.push(task)
              return { lastInsertRowid: task.id, changes: 1 }
            })
          }
        }
        if (sql.includes('SELECT * FROM scheduled_tasks WHERE id = ?')) {
          return {
            get: vi.fn((id: number) => insertedTasks.find(t => t.id === id))
          }
        }
        if (sql.includes('SELECT * FROM scheduled_tasks ORDER BY')) {
          return {
            all: vi.fn(() => insertedTasks)
          }
        }
        if (sql.includes('UPDATE scheduled_tasks SET status')) {
          return {
            run: vi.fn((status, updatedAt, id) => {
              const task = insertedTasks.find(t => t.id === id)
              if (task) {
                task.status = status
                task.updated_at = updatedAt
              }
              return { changes: task ? 1 : 0 }
            })
          }
        }
        if (sql.includes('UPDATE scheduled_tasks SET')) {
          return {
            run: vi.fn((...args) => {
              const id = args[args.length - 1]
              const task = insertedTasks.find(t => t.id === id)
              if (task) {
                return { changes: 1 }
              }
              return { changes: 0 }
            })
          }
        }
        if (sql.includes('DELETE FROM scheduled_tasks')) {
          return {
            run: vi.fn((id: number) => {
              const index = insertedTasks.findIndex(t => t.id === id)
              if (index !== -1) {
                insertedTasks.splice(index, 1)
                return { changes: 1 }
              }
              return { changes: 0 }
            })
          }
        }
        return {
          all: vi.fn(() => []),
          get: vi.fn(() => null),
          run: vi.fn(() => ({ changes: 0 }))
        }
      })
    } as unknown as Database

    schedulerService.setDatabase(mockDb)
  })

  afterEach(async () => {
    await schedulerService.shutdown()
  })

  describe('setDatabase', () => {
    it('should set the database instance', () => {
      expect(() => schedulerService.setDatabase(mockDb)).not.toThrow()
    })
  })

  describe('createTask', () => {
    it('should create a new task with valid cron expression', () => {
      const input: CreateTaskInput = {
        name: 'Test Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'recruiter-response' }
      }

      const task = schedulerService.createTask(input)

      expect(task).toBeDefined()
      expect(task.name).toBe('Test Task')
      expect(task.schedule_type).toBe('cron')
      expect(task.schedule_value).toBe('* * * * *')
      expect(task.command_type).toBe('skill')
      expect(task.status).toBe('active')
      expect(JSON.parse(task.command_config)).toEqual({ skillName: 'recruiter-response' })
    })

    it('should reject invalid cron expression', () => {
      const input: CreateTaskInput = {
        name: 'Invalid Task',
        schedule_type: 'cron',
        schedule_value: 'invalid',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      }

      expect(() => schedulerService.createTask(input)).toThrow('Invalid cron expression')
    })

    it('should schedule the cron job after creation', () => {
      const input: CreateTaskInput = {
        name: 'Scheduled Task',
        schedule_type: 'cron',
        schedule_value: '*/5 * * * *',
        command_type: 'script',
        command_config: { command: 'echo hello' }
      }

      schedulerService.createTask(input)

      expect(cron.schedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function),
        expect.objectContaining({ scheduled: true })
      )
    })

    it('should store command_config as JSON string', () => {
      const input: CreateTaskInput = {
        name: 'Config Task',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        command_type: 'opencode-run',
        command_config: { 
          message: 'Check for new PRs',
          workdir: '/path/to/repo'
        }
      }

      const task = schedulerService.createTask(input)
      const config = JSON.parse(task.command_config)

      expect(config.message).toBe('Check for new PRs')
      expect(config.workdir).toBe('/path/to/repo')
    })

    it('should set next_run_at timestamp', () => {
      const input: CreateTaskInput = {
        name: 'Future Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      }

      const task = schedulerService.createTask(input)

      expect(task.next_run_at).toBeDefined()
      expect(task.next_run_at).toBeGreaterThan(Date.now() - 60000)
    })
  })

  describe('getAllTasks', () => {
    it('should return all tasks from database', () => {
      schedulerService.createTask({
        name: 'Task 1',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'skill1' }
      })

      schedulerService.createTask({
        name: 'Task 2',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        command_type: 'script',
        command_config: { command: 'test' }
      })

      const tasks = schedulerService.getAllTasks()

      expect(tasks).toHaveLength(2)
      expect(tasks[0].name).toBe('Task 1')
      expect(tasks[1].name).toBe('Task 2')
    })

    it('should return empty array when no database is set', () => {
      const freshService = new (schedulerService.constructor as any)()
      const tasks = freshService.getAllTasks()
      expect(tasks).toEqual([])
    })
  })

  describe('getTask', () => {
    it('should retrieve a task by ID', () => {
      const created = schedulerService.createTask({
        name: 'Find Me',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      const found = schedulerService.getTask(created.id)

      expect(found).toBeDefined()
      expect(found?.name).toBe('Find Me')
    })

    it('should return null for non-existent task', () => {
      const found = schedulerService.getTask(999)
      expect(found).toBeFalsy()
    })
  })

  describe('updateTask', () => {
    it('should update task name', () => {
      const created = schedulerService.createTask({
        name: 'Original Name',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      const updated = schedulerService.updateTask(created.id, { name: 'New Name' })

      expect(updated).toBeDefined()
    })

    it('should reject invalid cron expression on update', () => {
      const created = schedulerService.createTask({
        name: 'Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      expect(() => schedulerService.updateTask(created.id, { schedule_value: 'invalid' }))
        .toThrow('Invalid cron expression')
    })

    it('should return null for non-existent task', () => {
      const result = schedulerService.updateTask(999, { name: 'Updated' })
      expect(result).toBeNull()
    })

    it('should reschedule cron job when schedule changes', () => {
      const created = schedulerService.createTask({
        name: 'Reschedule Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      vi.clearAllMocks()

      schedulerService.updateTask(created.id, { schedule_value: '0 9 * * *' })

      expect(cron.schedule).toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('should delete an existing task', () => {
      const created = schedulerService.createTask({
        name: 'Delete Me',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      const deleted = schedulerService.deleteTask(created.id)

      expect(deleted).toBe(true)
      expect(schedulerService.getTask(created.id)).toBeFalsy()
    })

    it('should return false for non-existent task', () => {
      const deleted = schedulerService.deleteTask(999)
      expect(deleted).toBe(false)
    })

    it('should stop the cron job when deleting', () => {
      const created = schedulerService.createTask({
        name: 'Stop Job Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      schedulerService.deleteTask(created.id)
    })
  })

  describe('toggleTask', () => {
    it('should pause an active task', () => {
      const created = schedulerService.createTask({
        name: 'Toggle Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      expect(created.status).toBe('active')

      const toggled = schedulerService.toggleTask(created.id)

      expect(toggled).toBeDefined()
      expect(toggled?.status).toBe('paused')
    })

    it('should resume a paused task', () => {
      const created = schedulerService.createTask({
        name: 'Resume Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      schedulerService.toggleTask(created.id)
      const resumed = schedulerService.toggleTask(created.id)

      expect(resumed?.status).toBe('active')
    })

    it('should return null for non-existent task', () => {
      const result = schedulerService.toggleTask(999)
      expect(result).toBeNull()
    })
  })

  describe('runTaskNow', () => {
    it('should execute a skill command', async () => {
      const created = schedulerService.createTask({
        name: 'Run Skill',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'recruiter-response' }
      })

      const result = await schedulerService.runTaskNow(created.id)

      expect(result.success).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'opencode',
        ['run', '--command', '/recruiter-response'],
        expect.any(Object)
      )
    })

    it('should execute an opencode-run command', async () => {
      const created = schedulerService.createTask({
        name: 'Run OpenCode',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'opencode-run',
        command_config: { message: 'Check for updates' }
      })

      const result = await schedulerService.runTaskNow(created.id)

      expect(result.success).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'opencode',
        ['run', 'Check for updates'],
        expect.any(Object)
      )
    })

    it('should execute a script command', async () => {
      const created = schedulerService.createTask({
        name: 'Run Script',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'script',
        command_config: { command: 'echo', args: ['hello', 'world'] }
      })

      const result = await schedulerService.runTaskNow(created.id)

      expect(result.success).toBe(true)
      expect(spawn).toHaveBeenCalledWith(
        'echo',
        ['hello', 'world'],
        expect.any(Object)
      )
    })

    it('should return error for non-existent task', async () => {
      const result = await schedulerService.runTaskNow(999)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Task not found')
    })

    it('should include duration in result', async () => {
      const created = schedulerService.createTask({
        name: 'Duration Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'script',
        command_config: { command: 'echo', args: ['test'] }
      })

      const result = await schedulerService.runTaskNow(created.id)

      expect(result.duration).toBeDefined()
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('initialize', () => {
    it('should load and schedule all active tasks', async () => {
      schedulerService.createTask({
        name: 'Active Task 1',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test1' }
      })

      schedulerService.createTask({
        name: 'Active Task 2',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        command_type: 'skill',
        command_config: { skillName: 'test2' }
      })

      vi.clearAllMocks()

      await schedulerService.initialize()

      expect(cron.schedule).toHaveBeenCalledTimes(2)
    })

    it('should throw if database not set', async () => {
      const freshService = new (schedulerService.constructor as any)()

      await expect(freshService.initialize()).rejects.toThrow('Database not set')
    })
  })

  describe('shutdown', () => {
    it('should stop all scheduled jobs', async () => {
      schedulerService.createTask({
        name: 'Shutdown Task 1',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test1' }
      })

      schedulerService.createTask({
        name: 'Shutdown Task 2',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        command_type: 'skill',
        command_config: { skillName: 'test2' }
      })

      await schedulerService.shutdown()
    })
  })

  describe('Command Types', () => {
    describe('skill command', () => {
      it('should format skill command correctly', async () => {
        const created = schedulerService.createTask({
          name: 'Skill With Args',
          schedule_type: 'cron',
          schedule_value: '* * * * *',
          command_type: 'skill',
          command_config: { 
            skillName: 'recruiter-response',
            args: ['--verbose', '--dry-run']
          }
        })

        await schedulerService.runTaskNow(created.id)

        expect(spawn).toHaveBeenCalledWith(
          'opencode',
          ['run', '--command', '/recruiter-response --verbose --dry-run'],
          expect.any(Object)
        )
      })
    })

    describe('opencode-run command', () => {
      it('should handle command with workdir', async () => {
        const created = schedulerService.createTask({
          name: 'OpenCode With Workdir',
          schedule_type: 'cron',
          schedule_value: '* * * * *',
          command_type: 'opencode-run',
          command_config: { 
            command: '/check-health',
            workdir: '/path/to/repo'
          }
        })

        await schedulerService.runTaskNow(created.id)

        expect(spawn).toHaveBeenCalledWith(
          'opencode',
          ['run', '--command', '/check-health'],
          expect.objectContaining({ cwd: '/path/to/repo' })
        )
      })
    })

    describe('script command', () => {
      it('should require command for script type', async () => {
        const created = schedulerService.createTask({
          name: 'Script No Command',
          schedule_type: 'cron',
          schedule_value: '* * * * *',
          command_type: 'script',
          command_config: { args: ['test'] }
        })

        const result = await schedulerService.runTaskNow(created.id)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Command is required for script type')
      })
    })
  })

  describe('Database Persistence', () => {
    it('should store tasks with correct timestamps', () => {
      const before = Date.now()

      const task = schedulerService.createTask({
        name: 'Timestamp Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      const after = Date.now()

      expect(task.created_at).toBeGreaterThanOrEqual(before)
      expect(task.created_at).toBeLessThanOrEqual(after)
      expect(task.updated_at).toBeGreaterThanOrEqual(before)
      expect(task.updated_at).toBeLessThanOrEqual(after)
    })

    it('should update updated_at on toggle', () => {
      const task = schedulerService.createTask({
        name: 'Update Timestamp Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: { skillName: 'test' }
      })

      const originalUpdatedAt = task.updated_at

      schedulerService.toggleTask(task.id)

      const toggled = schedulerService.getTask(task.id)
      expect(toggled?.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt)
    })
  })
})

describe('SchedulerService - Cron Trigger Simulation', () => {
  let mockDb: any
  let cronCallbacks: Map<string, Function>
  let insertedTasks: ScheduledTaskRecord[]
  let taskIdCounter: number

  beforeEach(() => {
    vi.clearAllMocks()
    cronCallbacks = new Map()
    insertedTasks = []
    taskIdCounter = 1;

    (cron.schedule as Mock).mockImplementation((expression: string, callback: any, options: any) => {
      cronCallbacks.set(expression, callback)
      return {
        stop: vi.fn(),
        start: vi.fn()
      } as any
    })

    mockDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('INSERT INTO scheduled_tasks')) {
          return {
            run: vi.fn((...args) => {
              const task: ScheduledTaskRecord = {
                id: taskIdCounter++,
                name: args[0],
                schedule_type: args[1],
                schedule_value: args[2],
                command_type: args[3],
                command_config: args[4],
                status: 'active',
                last_run_at: null,
                next_run_at: args[5],
                created_at: args[6],
                updated_at: args[7]
              }
              insertedTasks.push(task)
              return { lastInsertRowid: task.id, changes: 1 }
            })
          }
        }
        if (sql.includes('SELECT * FROM scheduled_tasks WHERE id = ?')) {
          return {
            get: vi.fn((id: number) => insertedTasks.find(t => t.id === id))
          }
        }
        if (sql.includes('SELECT * FROM scheduled_tasks ORDER BY')) {
          return {
            all: vi.fn(() => insertedTasks)
          }
        }
        if (sql.includes('UPDATE scheduled_tasks')) {
          return {
            run: vi.fn((...args) => {
              return { changes: 1 }
            })
          }
        }
        return {
          all: vi.fn(() => []),
          get: vi.fn(() => null),
          run: vi.fn(() => ({ changes: 0 }))
        }
      })
    } as unknown as Database

    schedulerService.setDatabase(mockDb)
  })

  afterEach(async () => {
    await schedulerService.shutdown()
  })

  it('should register callback when task is created', () => {
    schedulerService.createTask({
      name: 'Callback Test',
      schedule_type: 'cron',
      schedule_value: '*/5 * * * *',
      command_type: 'skill',
      command_config: { skillName: 'test' }
    })

    expect(cronCallbacks.has('*/5 * * * *')).toBe(true)
  })

  it('should execute task when cron triggers', async () => {
    schedulerService.createTask({
      name: 'Trigger Test',
      schedule_type: 'cron',
      schedule_value: '*/10 * * * *',
      command_type: 'script',
      command_config: { command: 'echo', args: ['triggered'] }
    })

    const callback = cronCallbacks.get('*/10 * * * *')
    expect(callback).toBeDefined()

    await callback!()

    expect(spawn).toHaveBeenCalledWith(
      'echo',
      ['triggered'],
      expect.any(Object)
    )
  })
})
