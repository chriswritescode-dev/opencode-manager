import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { showToast } from '@/lib/toast'
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Edit2,
  PlayCircle,
  Clock,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  toggleTask,
  runTaskNow,
  formatCronExpression,
  formatNextRun,
  formatLastRun,
  parseCommandConfig,
  type ScheduledTask,
  type CreateTaskInput,
  type UpdateTaskInput,
  type CommandConfig,
} from '@/api/tasks'

const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day at 9am', value: '0 9 * * *' },
  { label: 'Every day at midnight', value: '0 0 * * *' },
  { label: 'Every Monday at 9am', value: '0 9 * * 1' },
  { label: 'Custom', value: 'custom' },
]

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: ScheduledTask
  onSave: (data: CreateTaskInput | UpdateTaskInput) => void
  isSaving: boolean
}

function TaskDialog({ open, onOpenChange, task, onSave, isSaving }: TaskDialogProps) {
  const isEditing = !!task
  const config = task ? parseCommandConfig(task.command_config) : {}

  const [name, setName] = useState(task?.name || '')
  const [schedulePreset, setSchedulePreset] = useState<string>('custom')
  const [scheduleValue, setScheduleValue] = useState(task?.schedule_value || '0 9 * * *')
  const [commandType, setCommandType] = useState<'skill' | 'opencode-run' | 'script'>(
    (task?.command_type as 'skill' | 'opencode-run' | 'script') || 'opencode-run'
  )
  const [skillName, setSkillName] = useState(config.skillName || '')
  const [message, setMessage] = useState(config.message || '')
  const [command, setCommand] = useState(config.command || '')
  const [workdir, setWorkdir] = useState(config.workdir || '')

  const handlePresetChange = (value: string) => {
    setSchedulePreset(value)
    if (value !== 'custom') {
      setScheduleValue(value)
    }
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      showToast.error('Task name is required')
      return
    }
    if (!scheduleValue.trim()) {
      showToast.error('Schedule is required')
      return
    }

    const commandConfig: CommandConfig = { workdir: workdir || undefined }
    if (commandType === 'skill') {
      if (!skillName.trim()) {
        showToast.error('Skill name is required')
        return
      }
      commandConfig.skillName = skillName
    } else if (commandType === 'opencode-run') {
      if (!message.trim()) {
        showToast.error('Message is required')
        return
      }
      commandConfig.message = message
    } else if (commandType === 'script') {
      if (!command.trim()) {
        showToast.error('Command is required')
        return
      }
      commandConfig.command = command
    }

    if (isEditing) {
      onSave({
        name,
        schedule_value: scheduleValue,
        command_type: commandType,
        command_config: commandConfig,
      } as UpdateTaskInput)
    } else {
      onSave({
        name,
        schedule_type: 'cron',
        schedule_value: scheduleValue,
        command_type: commandType,
        command_config: commandConfig,
      } as CreateTaskInput)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Task' : 'Create Scheduled Task'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Task Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Daily recruiter response check"
            />
          </div>

          <div className="grid gap-2">
            <Label>Schedule</Label>
            <Select value={schedulePreset} onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select schedule" />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={scheduleValue}
              onChange={(e) => setScheduleValue(e.target.value)}
              placeholder="Cron expression (e.g., 0 9 * * *)"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              <a
                href="https://crontab.guru/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-400 hover:underline"
              >
                Cron expression help <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Command Type</Label>
            <Select value={commandType} onValueChange={(v) => setCommandType(v as typeof commandType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="opencode-run">OpenCode Run</SelectItem>
                <SelectItem value="skill">OpenCode Skill</SelectItem>
                <SelectItem value="script">Script</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {commandType === 'skill' && (
            <div className="grid gap-2">
              <Label htmlFor="skillName">Skill Name</Label>
              <Input
                id="skillName"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="e.g., recruiter-response"
              />
            </div>
          )}

          {commandType === 'opencode-run' && (
            <div className="grid gap-2">
              <Label htmlFor="message">Message</Label>
              <Input
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Message to send to OpenCode"
              />
            </div>
          )}

          {commandType === 'script' && (
            <div className="grid gap-2">
              <Label htmlFor="command">Command</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., /bin/bash myscript.sh"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="workdir">Working Directory (optional)</Label>
            <Input
              id="workdir"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder="Leave empty for default"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TasksPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>()
  const [runningTaskId, setRunningTaskId] = useState<number | null>(null)

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: getTasks,
    refetchInterval: 30000,
  })

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      showToast.success('Task created successfully')
      setDialogOpen(false)
    },
    onError: (error: Error) => {
      showToast.error(`Failed to create task: ${error.message}`)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateTaskInput }) => updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      showToast.success('Task updated successfully')
      setDialogOpen(false)
      setEditingTask(undefined)
    },
    onError: (error: Error) => {
      showToast.error(`Failed to update task: ${error.message}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      showToast.success('Task deleted')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to delete task: ${error.message}`)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: toggleTask,
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      showToast.success(`Task ${task.status === 'active' ? 'resumed' : 'paused'}`)
    },
    onError: (error: Error) => {
      showToast.error(`Failed to toggle task: ${error.message}`)
    },
  })

  const runNowMutation = useMutation({
    mutationFn: runTaskNow,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      if (result.success) {
        showToast.success(`Task completed in ${result.duration}ms`)
      } else {
        showToast.error(`Task failed: ${result.error}`)
      }
      setRunningTaskId(null)
    },
    onError: (error: Error) => {
      showToast.error(`Failed to run task: ${error.message}`)
      setRunningTaskId(null)
    },
  })

  const handleSave = (data: CreateTaskInput | UpdateTaskInput) => {
    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, data: data as UpdateTaskInput })
    } else {
      createMutation.mutate(data as CreateTaskInput)
    }
  }

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task)
    setDialogOpen(true)
  }

  const handleRunNow = (task: ScheduledTask) => {
    setRunningTaskId(task.id)
    runNowMutation.mutate(task.id)
  }

  const handleCloseDialog = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingTask(undefined)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background">
      <Header
        title="Scheduled Tasks"
        backTo="/"
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="bg-card border rounded-lg p-12 text-center">
            <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Scheduled Tasks</h3>
            <p className="text-muted-foreground mb-4">
              Create a scheduled task to run OpenCode commands automatically.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Task
            </Button>
          </div>
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const config = parseCommandConfig(task.command_config)
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {formatCronExpression(task.schedule_value)}
                        </span>
                        <span className="block text-xs font-mono text-muted-foreground/60">
                          {task.schedule_value}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {task.command_type === 'skill'
                            ? `Skill: ${config.skillName}`
                            : task.command_type === 'opencode-run'
                            ? 'OpenCode'
                            : 'Script'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={task.status === 'active' ? 'default' : 'secondary'}
                          className={
                            task.status === 'active'
                              ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                              : ''
                          }
                        >
                          {task.status === 'active' ? 'Active' : 'Paused'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatLastRun(task.last_run_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {task.status === 'active' ? formatNextRun(task.next_run_at) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRunNow(task)}
                            disabled={runningTaskId === task.id}
                            title="Run now"
                          >
                            {runningTaskId === task.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <PlayCircle className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleMutation.mutate(task.id)}
                            title={task.status === 'active' ? 'Pause' : 'Resume'}
                          >
                            {task.status === 'active' ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(task)}
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(task.id)}
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={handleCloseDialog}
        task={editingTask}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  )
}
