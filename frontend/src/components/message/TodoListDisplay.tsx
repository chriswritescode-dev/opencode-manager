import type { components } from '@/api/opencode-types'
import { TodoItem } from './TodoItem'
import { useEffect, useRef } from 'react'

export type Todo = components['schemas']['Todo']

interface TodoListDisplayProps {
  todos: Todo[]
  title?: string
  showCompleted?: boolean
  scrollCurrentOnly?: boolean
  isLoading?: boolean
}

export function TodoListDisplay({
  todos,
  title = 'Todo List',
  showCompleted = true,
  scrollCurrentOnly = false,
  isLoading = false,
}: TodoListDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Filter completed tasks if not showing them
  const filteredTodos = showCompleted
    ? todos
    : todos.filter((t) => t.status !== 'completed')

  // Group by status for better organization
  const inProgress = filteredTodos.filter((t) => t.status === 'in_progress')
  const pending = filteredTodos.filter((t) => t.status === 'pending')
  const completed = showCompleted
    ? filteredTodos.filter((t) => t.status === 'completed')
    : []

  const hasMultipleGroups =
    (inProgress.length > 0 ? 1 : 0) +
    (pending.length > 0 ? 1 : 0) +
    (completed.length > 0 ? 1 : 0) >
    1

  // Auto-scroll to current task (in_progress or first pending) within container only
  useEffect(() => {
    if (scrollRef.current && scrollCurrentOnly && filteredTodos.length > 0) {
      const container = scrollRef.current
      const currentElement = container.querySelector('[data-status="in_progress"], [data-status="pending"]') as HTMLElement | null
      if (currentElement) {
        const containerTop = container.scrollTop
        const containerHeight = container.clientHeight
        const elementTop = currentElement.offsetTop - container.offsetTop
        const elementHeight = currentElement.offsetHeight
        
        if (elementTop < containerTop) {
          container.scrollTop = elementTop
        } else if (elementTop + elementHeight > containerTop + containerHeight) {
          container.scrollTop = elementTop + elementHeight - containerHeight
        }
      }
    }
  }, [todos, scrollCurrentOnly, filteredTodos.length])

  // Empty states
  if (!todos || todos.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No tasks in the todo list.
      </div>
    )
  }

  if (filteredTodos.length === 0) {
    return (
      <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
        <span className="text-lg">✓</span>
        <span>All tasks completed!</span>
      </div>
    )
  }

  const renderGroup = (label: string, items: Todo[], isCollapsible = false) => {
    if (items.length === 0) return null
    return (
      <div className="mb-1 last:mb-0">
        {hasMultipleGroups && (
          <div className="text-[9px] font-medium text-muted-foreground mb-0.5 ml-4 uppercase tracking-wider opacity-70">
            {label} ({items.length})
          </div>
        )}
        <div className={isCollapsible && items.length > 3 ? 'max-h-[60px] overflow-hidden relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-4 after:bg-gradient-to-t after:from-card after:to-transparent' : ''}>
          {items.map((todo) => (
            <div key={todo.id} data-status={todo.status}>
              <TodoItem todo={todo} compact />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const progress = filteredTodos.length > 0 
    ? Math.round((filteredTodos.filter(t => t.status === 'completed').length / filteredTodos.length) * 100)
    : 0

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      {/* Compact header with progress bar */}
      <div className="px-2 py-1.5 border-b bg-muted/50 flex items-center gap-2">
        <span className="font-semibold text-xs">{title}</span>
        {isLoading && (
          <span className="w-2.5 h-2.5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
        )}
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-600 transition-all duration-500" 
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
          {filteredTodos.filter(t => t.status === 'completed').length}/{filteredTodos.length}
        </span>
      </div>
      
      {/* Scrollable content area - optimized height for visibility */}
      <div 
        ref={scrollRef}
        className={`max-h-[160px] sm:max-h-[280px] overflow-y-auto ${scrollCurrentOnly ? 'scroll-smooth' : ''} p-1.5 sm:p-2`}
      >
        {renderGroup('In Progress', inProgress)}
        {renderGroup('Pending', pending)}
        {renderGroup('Completed', completed, true)}
      </div>
    </div>
  )
}
