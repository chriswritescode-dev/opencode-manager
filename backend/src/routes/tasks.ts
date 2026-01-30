import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { schedulerService, type CreateTaskInput, type UpdateTaskInput, type CommandConfig } from '../services/scheduler'
import { logger } from '../utils/logger'

const CommandConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  workdir: z.string().optional(),
  skillName: z.string().optional(),
  message: z.string().optional(),
})

const CreateTaskSchema = z.object({
  name: z.string().min(1).max(255),
  schedule_type: z.literal('cron'),
  schedule_value: z.string().min(1),
  command_type: z.enum(['skill', 'opencode-run', 'script']),
  command_config: CommandConfigSchema,
})

const UpdateTaskSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  schedule_value: z.string().min(1).optional(),
  command_type: z.enum(['skill', 'opencode-run', 'script']).optional(),
  command_config: CommandConfigSchema.optional(),
})

export function createTaskRoutes(db: Database) {
  const app = new Hono()

  schedulerService.setDatabase(db)

  app.get('/', async (c) => {
    try {
      const tasks = schedulerService.getAllTasks()
      return c.json(tasks)
    } catch (error) {
      logger.error('Failed to get tasks:', error)
      return c.json({ error: 'Failed to get tasks' }, 500)
    }
  })

  app.get('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (isNaN(id)) {
        return c.json({ error: 'Invalid task ID' }, 400)
      }

      const task = schedulerService.getTask(id)
      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json(task)
    } catch (error) {
      logger.error('Failed to get task:', error)
      return c.json({ error: 'Failed to get task' }, 500)
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const validated = CreateTaskSchema.parse(body)

      const task = schedulerService.createTask(validated as CreateTaskInput)
      return c.json(task, 201)
    } catch (error) {
      logger.error('Failed to create task:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid task data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid cron')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to create task' }, 500)
    }
  })

  app.put('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (isNaN(id)) {
        return c.json({ error: 'Invalid task ID' }, 400)
      }

      const body = await c.req.json()
      const validated = UpdateTaskSchema.parse(body)

      const task = schedulerService.updateTask(id, validated as UpdateTaskInput)
      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json(task)
    } catch (error) {
      logger.error('Failed to update task:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid task data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('Invalid cron')) {
        return c.json({ error: error.message }, 400)
      }
      return c.json({ error: 'Failed to update task' }, 500)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (isNaN(id)) {
        return c.json({ error: 'Invalid task ID' }, 400)
      }

      const deleted = schedulerService.deleteTask(id)
      if (!deleted) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete task:', error)
      return c.json({ error: 'Failed to delete task' }, 500)
    }
  })

  app.post('/:id/toggle', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (isNaN(id)) {
        return c.json({ error: 'Invalid task ID' }, 400)
      }

      const task = schedulerService.toggleTask(id)
      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json(task)
    } catch (error) {
      logger.error('Failed to toggle task:', error)
      return c.json({ error: 'Failed to toggle task' }, 500)
    }
  })

  app.post('/:id/run', async (c) => {
    try {
      const id = parseInt(c.req.param('id'))
      if (isNaN(id)) {
        return c.json({ error: 'Invalid task ID' }, 400)
      }

      const result = await schedulerService.runTaskNow(id)
      return c.json(result)
    } catch (error) {
      logger.error('Failed to run task:', error)
      return c.json({ error: 'Failed to run task' }, 500)
    }
  })

  return app
}
