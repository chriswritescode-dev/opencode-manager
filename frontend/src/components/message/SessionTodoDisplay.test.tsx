import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionTodoDisplay } from './SessionTodoDisplay'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import type { Todo } from './SessionTodoDisplay'

const activeTodos: Todo[] = [
  { id: '1', content: 'Implement mobile header fix', status: 'in_progress', priority: 'high' },
  { id: '2', content: 'Add regression tests', status: 'pending', priority: 'medium' },
  { id: '3', content: 'Verify completed item grouping', status: 'completed', priority: 'low' },
]

const allCompletedTodos: Todo[] = [
  { id: '1', content: 'Task one', status: 'completed', priority: 'high' },
  { id: '2', content: 'Task two', status: 'completed', priority: 'medium' },
]

describe('SessionTodoDisplay', () => {
  beforeEach(() => {
    useSessionTodos.setState({ todos: new Map() })
  })

  it('renders collapsed by default', () => {
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    render(<SessionTodoDisplay sessionID="session-1" />)

    expect(screen.getByText('Tasks: 1/3 complete')).toBeInTheDocument()

    expect(screen.queryByText('Implement mobile header fix')).not.toBeInTheDocument()
    expect(screen.queryByText('Add regression tests')).not.toBeInTheDocument()
  })

  it('expands to show a small scrollable task preview when clicked', async () => {
    const user = userEvent.setup()
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    render(<SessionTodoDisplay sessionID="session-1" />)

    const collapsedRow = screen.getByText('Tasks: 1/3 complete')
    await user.click(collapsedRow)

    expect(screen.getByText('Implement mobile header fix')).toBeInTheDocument()
    expect(screen.getByText('Add regression tests')).toBeInTheDocument()
    expect(screen.getByText('Verify completed item grouping')).toBeInTheDocument()

    const expandedContainer = screen.getByTestId('todo-expanded-list')
    expect(expandedContainer).toHaveClass('max-h-[80px]')
    expect(expandedContainer).toHaveClass('sm:max-h-[160px]')
    expect(expandedContainer).toHaveClass('overflow-y-auto')
  })

  it('collapses again when expanded header is clicked', async () => {
    const user = userEvent.setup()
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    render(<SessionTodoDisplay sessionID="session-1" />)

    const collapsedRow = screen.getByText('Tasks: 1/3 complete')
    await user.click(collapsedRow)

    expect(screen.getByTestId('todo-expanded-list')).toBeInTheDocument()

    const expandedHeader = screen.getByText('Tasks: 1/3 complete')
    await user.click(expandedHeader)

    expect(screen.queryByTestId('todo-expanded-list')).not.toBeInTheDocument()
  })

  it('does not render when all tasks are completed', () => {
    useSessionTodos.getState().setTodos('session-1', allCompletedTodos)

    const { container } = render(<SessionTodoDisplay sessionID="session-1" />)

    expect(container.firstChild).toBeNull()
  })

  it('dismisses current todo signature and reappears when todo status changes', async () => {
    const user = userEvent.setup()
    useSessionTodos.getState().setTodos('session-1', activeTodos)

    const { rerender } = render(<SessionTodoDisplay sessionID="session-1" />)

    expect(screen.getByText('Tasks: 1/3 complete')).toBeInTheDocument()

    const dismissButton = screen.getByLabelText('Dismiss tasks')
    await user.click(dismissButton)

    expect(screen.queryByText('Tasks: 1/3 complete')).not.toBeInTheDocument()

    const updatedTodos: Todo[] = [
      { id: '1', content: 'Implement mobile header fix', status: 'completed', priority: 'high' },
      { id: '2', content: 'Add regression tests', status: 'pending', priority: 'medium' },
      { id: '3', content: 'Verify completed item grouping', status: 'completed', priority: 'low' },
    ]
    useSessionTodos.getState().setTodos('session-1', updatedTodos)

    rerender(<SessionTodoDisplay sessionID="session-1" />)

    expect(screen.getByText('Tasks: 2/3 complete')).toBeInTheDocument()
  })
})
