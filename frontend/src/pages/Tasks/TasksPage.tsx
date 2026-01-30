import { useState, useEffect } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Play, Pause, Trash2, Zap } from 'lucide-react'
import { CreateTaskDialog } from './CreateTaskDialog'
import { useToast } from '@/components/ui/use-toast'
import { formatDistanceToNow } from 'date-fns'

interface Task {
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
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const { toast } = useToast()

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks')
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const data = await res.json()
      setTasks(data)
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load tasks',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this task?')) return
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setTasks(tasks.filter((t) => t.id !== id))
      toast({ title: 'Task deleted' })
    } catch {
      toast({ title: 'Error', description: 'Failed to delete task', variant: 'destructive' })
    }
  }

  const handleToggle = async (id: number) => {
    try {
      const res = await fetch(`/api/tasks/${id}/toggle`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to toggle')
      const updated = await res.json()
      setTasks(tasks.map((t) => (t.id === id ? updated : t)))
      toast({ title: `Task ${updated.status === 'active' ? 'resumed' : 'paused'}` })
    } catch {
      toast({ title: 'Error', description: 'Failed to toggle task', variant: 'destructive' })
    }
  }

  const handleRunNow = async (id: number) => {
    try {
      const res = await fetch(`/api/tasks/${id}/run`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to run')
      toast({ title: 'Task execution started' })
      // Optionally refresh to see last run update, though it might take a moment
      setTimeout(fetchTasks, 1000)
    } catch {
      toast({ title: 'Error', description: 'Failed to run task', variant: 'destructive' })
    }
  }

  if (loading) return <div className="p-8">Loading tasks...</div>

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduled Tasks</h1>
          <p className="text-muted-foreground mt-1">
            Automate your workflow with cron-based tasks.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Create Task
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Schedules</CardTitle>
          <CardDescription>Manage your automated jobs and skills.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Schedule (Cron)</TableHead>
                <TableHead>Command</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    No scheduled tasks found. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.name}</TableCell>
                    <TableCell>
                      <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                        {task.schedule_value}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium capitalize">{task.command_type}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {(() => {
                                try {
                                    const config = JSON.parse(task.command_config)
                                    return config.skillName || config.command || 'Configured'
                                } catch { return 'Invalid Config' }
                            })()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={task.status === 'active' ? 'default' : 'secondary'}>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {task.last_run_at
                        ? formatDistanceToNow(task.last_run_at, { addSuffix: true })
                        : 'Never'}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRunNow(task.id)}
                        title="Run Now"
                      >
                        <Zap className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggle(task.id)}
                        title={task.status === 'active' ? 'Pause' : 'Resume'}
                      >
                        {task.status === 'active' ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(task.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateTaskDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
            setIsCreateOpen(false)
            fetchTasks()
        }}
      />
    </div>
  )
}
