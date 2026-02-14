import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TodoItem } from './TodoItem'
import { useSessionTodosForSession } from '@/stores/sessionTodosStore'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import type { components } from '@/api/opencode-types'

export type Todo = components['schemas']['Todo']

interface SessionTodoDisplayProps {
  sessionID: string | undefined
}

export function SessionTodoDisplay({ sessionID }: SessionTodoDisplayProps) {
  const todos = useSessionTodosForSession(sessionID)
  const sessionStatus = useSessionStatusForSession(sessionID)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const isSessionActive = sessionStatus.type === 'busy' || sessionStatus.type === 'compact' || sessionStatus.type === 'retry'

  const stats = useMemo(() => {
    const completed = todos.filter((t) => t.status === 'completed').length
    const total = todos.length
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    return { completed, total, percentage }
  }, [todos])

  const { inProgress, pending, completedTodos } = useMemo(() => ({
    inProgress: todos.filter((t) => t.status === 'in_progress'),
    pending: todos.filter((t) => t.status === 'pending'),
    completedTodos: todos.filter((t) => t.status === 'completed'),
  }), [todos])

  const hasMultipleGroups =
    (inProgress.length > 0 ? 1 : 0) +
    (pending.length > 0 ? 1 : 0) +
    (completedTodos.length > 0 ? 1 : 0) >
    1

  const renderGroup = (label: string, items: typeof todos) => {
    if (items.length === 0) return null
    return (
      <div className="mb-1 last:mb-0">
        {hasMultipleGroups && (
          <div className="text-[9px] font-medium text-muted-foreground mb-0.5 ml-4 uppercase tracking-wider opacity-70">
            {label} ({items.length})
          </div>
        )}
        <div>
          {items.map((todo) => (
            <div key={todo.id}>
              <TodoItem todo={todo} compact />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!sessionID || !isSessionActive || todos.length === 0 || stats.completed === stats.total) {
    return null
  }

  if (isCollapsed) {
    return (
      <div
        className="mb-2 px-3 py-2 bg-muted/50 rounded-lg cursor-pointer select-none"
        onClick={() => setIsCollapsed(false)}
      >
        <div className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Tasks: {stats.completed}/{stats.total} complete
          </span>
          <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${stats.percentage}%` }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-2 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/50 cursor-pointer select-none"
        onClick={() => setIsCollapsed(true)}
      >
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Tasks: {stats.completed}/{stats.total} complete
        </span>
        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${stats.percentage}%` }}
          />
        </div>
      </div>
      <div className="max-h-[80px] sm:max-h-[160px] overflow-y-auto p-1.5 sm:p-2 bg-muted/30">
        {renderGroup('In Progress', inProgress)}
        {renderGroup('Pending', pending)}
        {renderGroup('Completed', completedTodos)}
      </div>
    </div>
  )
}