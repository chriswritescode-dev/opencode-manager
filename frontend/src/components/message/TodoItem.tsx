import type { components } from '@/api/opencode-types'
import { CheckCircle2, Circle } from 'lucide-react'

export type Todo = components['schemas']['Todo']

interface TodoItemProps {
  todo: Todo
  compact?: boolean
}

export function TodoItem({ todo, compact = false }: TodoItemProps) {
  const isCompleted = todo.status === 'completed'
  const isInProgress = todo.status === 'in_progress'

  const priorityColor = todo.priority === 'high' 
    ? 'bg-red-500' 
    : todo.priority === 'medium' 
      ? 'bg-yellow-500' 
      : 'bg-blue-400'

  return (
    <div className={`flex items-center gap-1.5 ${compact ? 'py-0.5 text-xs' : 'py-1 text-sm'} pl-0.5`}>
      {isCompleted ? (
        <CheckCircle2 className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-green-600 dark:text-green-400 flex-shrink-0`} />
      ) : isInProgress ? (
        <span className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} rounded-full border-2 border-yellow-500 border-t-transparent animate-spin flex-shrink-0`} />
      ) : (
        <Circle className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-muted-foreground flex-shrink-0`} />
      )}
      {todo.priority && (
        <span className={`w-1.5 h-1.5 rounded-full ${priorityColor} flex-shrink-0`} />
      )}
      <span
        className={`flex-1 min-w-0 truncate ${
          isInProgress
            ? 'text-yellow-700 dark:text-yellow-300 font-medium'
            : isCompleted
              ? 'text-muted-foreground line-through opacity-60'
              : 'text-foreground'
        }`}
      >
        {todo.content}
      </span>
    </div>
  )
}
