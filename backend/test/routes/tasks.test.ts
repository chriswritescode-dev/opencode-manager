import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn()
}))

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn((expr: string) => {
      if (expr === 'invalid-cron') return false
      return true
    }),
    schedule: vi.fn(() => ({
      stop: vi.fn(),
      start: vi.fn()
    }))
  }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const mockProcess = {
      stdout: { on: vi.fn((event, cb) => { if (event === 'data') cb(Buffer.from('output')) }) },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => { if (event === 'close') setTimeout(() => cb(0), 10) }),
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

import { createTaskRoutes } from '../../src/routes/tasks'
import { schedulerService, type ScheduledTaskRecord } from '../../src/services/scheduler'

describe('Task Routes', () => {
  let app: Hono
  let mockDb: any
  let tasks: ScheduledTaskRecord[]
  let taskIdCounter: number

  beforeEach(() => {
    vi.clearAllMocks()
    tasks = []
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
              tasks.push(task)
              return { lastInsertRowid: task.id, changes: 1 }
            })
          }
        }
        if (sql.includes('SELECT * FROM scheduled_tasks WHERE id = ?')) {
          return {
            get: vi.fn((id: number) => tasks.find(t => t.id === id))
          }
        }
        if (sql.includes('SELECT * FROM scheduled_tasks ORDER BY')) {
          return {
            all: vi.fn(() => tasks)
          }
        }
        if (sql.includes('UPDATE scheduled_tasks SET status')) {
          return {
            run: vi.fn((status, updatedAt, id) => {
              const task = tasks.find(t => t.id === id)
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
              const task = tasks.find(t => t.id === id)
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
              const index = tasks.findIndex(t => t.id === id)
              if (index !== -1) {
                tasks.splice(index, 1)
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

    app = new Hono()
    app.route('/api/tasks', createTaskRoutes(mockDb))
  })

  afterEach(async () => {
    await schedulerService.shutdown()
  })

  describe('GET /api/tasks', () => {
    it('should return empty array when no tasks exist', async () => {
      const res = await app.request('/api/tasks')
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([])
    })

    it('should return all tasks', async () => {
      tasks.push({
        id: 1,
        name: 'Task 1',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: JSON.stringify({ skillName: 'test' }),
        status: 'active',
        last_run_at: null,
        next_run_at: Date.now() + 60000,
        created_at: Date.now(),
        updated_at: Date.now()
      })

      const res = await app.request('/api/tasks')
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].name).toBe('Task 1')
    })
  })

  describe('GET /api/tasks/:id', () => {
    it('should return a task by ID', async () => {
      tasks.push({
        id: 1,
        name: 'Find Me',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: JSON.stringify({ skillName: 'test' }),
        status: 'active',
        last_run_at: null,
        next_run_at: Date.now() + 60000,
        created_at: Date.now(),
        updated_at: Date.now()
      })

      const res = await app.request('/api/tasks/1')
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.name).toBe('Find Me')
    })

    it('should return 404 for non-existent task', async () => {
      const res = await app.request('/api/tasks/999')
      
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe('Task not found')
    })

    it('should return 400 for invalid ID', async () => {
      const res = await app.request('/api/tasks/invalid')
      
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid task ID')
    })
  })

  describe('POST /api/tasks', () => {
    it('should create a new task', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Task',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          command_type: 'skill',
          command_config: { skillName: 'recruiter-response' }
        })
      })
      
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.name).toBe('New Task')
      expect(body.schedule_value).toBe('0 9 * * *')
      expect(body.command_type).toBe('skill')
    })

    it('should validate required fields', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing Fields'
        })
      })
      
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid task data')
      expect(body.details).toBeDefined()
    })

    it('should validate command_type enum', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid Type',
          schedule_type: 'cron',
          schedule_value: '* * * * *',
          command_type: 'invalid-type',
          command_config: {}
        })
      })
      
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid task data')
    })

    it('should reject invalid cron expression', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid Cron',
          schedule_type: 'cron',
          schedule_value: 'invalid-cron',
          command_type: 'skill',
          command_config: { skillName: 'test' }
        })
      })
      
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Invalid cron')
    })

    it('should validate name length', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '', // empty name
          schedule_type: 'cron',
          schedule_value: '* * * * *',
          command_type: 'skill',
          command_config: { skillName: 'test' }
        })
      })
      
      expect(res.status).toBe(400)
    })

    it('should accept all valid command types', async () => {
      for (const cmdType of ['skill', 'opencode-run', 'script']) {
        const res = await app.request('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${cmdType} Task`,
            schedule_type: 'cron',
            schedule_value: '* * * * *',
            command_type: cmdType,
            command_config: cmdType === 'script' 
              ? { command: 'echo' } 
              : { skillName: 'test' }
          })
        })
        
        expect(res.status).toBe(201)
      }
    })
  })

  describe('PUT /api/tasks/:id', () => {
    beforeEach(() => {
      tasks.push({
        id: 1,
        name: 'Original Task',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: JSON.stringify({ skillName: 'original' }),
        status: 'active',
        last_run_at: null,
        next_run_at: Date.now() + 60000,
        created_at: Date.now(),
        updated_at: Date.now()
      })
    })

    it('should update task name', async () => {
      const res = await app.request('/api/tasks/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Name'
        })
      })
      
      expect(res.status).toBe(200)
    })

    it('should return 404 for non-existent task', async () => {
      const res = await app.request('/api/tasks/999', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated'
        })
      })
      
      expect(res.status).toBe(404)
    })

    it('should reject invalid cron on update', async () => {
      const res = await app.request('/api/tasks/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_value: 'invalid-cron'
        })
      })
      
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Invalid cron')
    })

    it('should return 400 for invalid ID', async () => {
      const res = await app.request('/api/tasks/invalid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated'
        })
      })
      
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/tasks/:id', () => {
    beforeEach(() => {
      tasks.push({
        id: 1,
        name: 'Delete Me',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: JSON.stringify({ skillName: 'test' }),
        status: 'active',
        last_run_at: null,
        next_run_at: Date.now() + 60000,
        created_at: Date.now(),
        updated_at: Date.now()
      })
    })

    it('should delete a task', async () => {
      const res = await app.request('/api/tasks/1', {
        method: 'DELETE'
      })
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('should return 404 for non-existent task', async () => {
      const res = await app.request('/api/tasks/999', {
        method: 'DELETE'
      })
      
      expect(res.status).toBe(404)
    })

    it('should return 400 for invalid ID', async () => {
      const res = await app.request('/api/tasks/invalid', {
        method: 'DELETE'
      })
      
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/tasks/:id/toggle', () => {
    beforeEach(() => {
      tasks.push({
        id: 1,
        name: 'Toggle Me',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'skill',
        command_config: JSON.stringify({ skillName: 'test' }),
        status: 'active',
        last_run_at: null,
        next_run_at: Date.now() + 60000,
        created_at: Date.now(),
        updated_at: Date.now()
      })
    })

    it('should toggle task status from active to paused', async () => {
      const res = await app.request('/api/tasks/1/toggle', {
        method: 'POST'
      })
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('paused')
    })

    it('should return 404 for non-existent task', async () => {
      const res = await app.request('/api/tasks/999/toggle', {
        method: 'POST'
      })
      
      expect(res.status).toBe(404)
    })

    it('should return 400 for invalid ID', async () => {
      const res = await app.request('/api/tasks/invalid/toggle', {
        method: 'POST'
      })
      
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/tasks/:id/run', () => {
    beforeEach(() => {
      tasks.push({
        id: 1,
        name: 'Run Me',
        schedule_type: 'cron',
        schedule_value: '* * * * *',
        command_type: 'script',
        command_config: JSON.stringify({ command: 'echo', args: ['hello'] }),
        status: 'active',
        last_run_at: null,
        next_run_at: Date.now() + 60000,
        created_at: Date.now(),
        updated_at: Date.now()
      })
    })

    it('should run task immediately', async () => {
      const res = await app.request('/api/tasks/1/run', {
        method: 'POST'
      })
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.output).toBeDefined()
      expect(body.duration).toBeDefined()
    })

    it('should return result with error for non-existent task', async () => {
      const res = await app.request('/api/tasks/999/run', {
        method: 'POST'
      })
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Task not found')
    })

    it('should return 400 for invalid ID', async () => {
      const res = await app.request('/api/tasks/invalid/run', {
        method: 'POST'
      })
      
      expect(res.status).toBe(400)
    })
  })

  describe('Command Config Validation', () => {
    it('should accept skill command config', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Skill Task',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          command_type: 'skill',
          command_config: {
            skillName: 'recruiter-response',
            args: ['--verbose']
          }
        })
      })
      
      expect(res.status).toBe(201)
    })

    it('should accept opencode-run command config', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'OpenCode Task',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          command_type: 'opencode-run',
          command_config: {
            message: 'Check for updates',
            workdir: '/path/to/repo'
          }
        })
      })
      
      expect(res.status).toBe(201)
    })

    it('should accept script command config', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Script Task',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          command_type: 'script',
          command_config: {
            command: '/usr/bin/python3',
            args: ['script.py', '--arg1'],
            workdir: '/path/to/scripts'
          }
        })
      })
      
      expect(res.status).toBe(201)
    })
  })
})
