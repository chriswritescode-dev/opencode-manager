import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentsMdEditor } from './AgentsMdEditor'

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getAgentsMd: vi.fn().mockResolvedValue({ content: '# Rules\n\nline two\nline three\n' }),
    updateAgentsMd: vi.fn().mockResolvedValue({ success: true, restartRequired: false }),
    getDefaultAgentsMd: vi.fn().mockResolvedValue({ content: '# Default' }),
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('AgentsMdEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the current AGENTS.md into the editor', async () => {
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    await waitFor(() =>
      expect(screen.getByLabelText('AGENTS.md content')).toHaveValue('# Rules\n\nline two\nline three\n'),
    )
  })

  it('renders a line number gutter', async () => {
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument())
    const numbers = Array.from(document.body.querySelectorAll('[data-line-number]'))
    expect(numbers.map((n) => n.textContent?.trim())).toEqual(['1', '2', '3', '4', '5'])
  })

  it('finds matches in the content', async () => {
    const user = userEvent.setup()
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument())
    const findInput = screen.getByLabelText('Find in content')
    await user.type(findInput, 'line')
    expect(screen.getByTestId('find-match-count')).toHaveTextContent('1 of 2')
    const marks = document.body.querySelectorAll('mark')
    expect(marks.length).toBe(2)
  })

  it('keeps Save disabled until the content changes', async () => {
    const user = userEvent.setup()
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const saveButton = await screen.findByRole('button', { name: 'Save' })
    expect(saveButton).toBeDisabled()
    const textarea = screen.getByLabelText('AGENTS.md content') as HTMLTextAreaElement
    await user.type(textarea, '!')
    expect(saveButton).toBeEnabled()
  })

  it('saves the edited content', async () => {
    const user = userEvent.setup()
    const { settingsApi } = await import('@/api/settings')
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const textarea = (await screen.findByLabelText('AGENTS.md content')) as HTMLTextAreaElement
    const edited = '# Rules\n\nline two\nline three\n# new section\n'
    fireEvent.change(textarea, { target: { value: edited } })
    const saveButton = screen.getByRole('button', { name: 'Save' })
    await user.click(saveButton)
    await waitFor(() => expect(settingsApi.updateAgentsMd).toHaveBeenCalled())
    expect(settingsApi.updateAgentsMd).toHaveBeenCalledWith(edited)
  })

  it('uses a 16px editor font on mobile', async () => {
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const textarea = await screen.findByLabelText('AGENTS.md content')
    expect(textarea.className).toContain('text-[16px]')
    expect(textarea.className).toContain('min-[769px]:text-sm')
    expect(textarea.className).not.toContain('text-xs')
  })

  it('locks the editor while a save is pending and preserves submitted content', async () => {
    const user = userEvent.setup()
    const { settingsApi } = await import('@/api/settings')
    let resolveSave: (value: { success: boolean; restartRequired?: boolean }) => void = () => {}
    ;(settingsApi.updateAgentsMd as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<{ success: boolean; restartRequired?: boolean }>((resolve) => {
        resolveSave = resolve
      }),
    )
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const textarea = (await screen.findByLabelText('AGENTS.md content')) as HTMLTextAreaElement
    const edited = '# Rules\n\nline two\nline three\nedit\n'
    fireEvent.change(textarea, { target: { value: edited } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(textarea).toBeDisabled())
    try {
      await user.type(textarea, 'lost edit')
    } catch {
      // user-event refuses to type into a disabled element; expected
    }
    expect(textarea).toHaveValue(edited)
    resolveSave({ success: true, restartRequired: false })
    await waitFor(() => expect(textarea).not.toBeDisabled())
    expect(textarea).toHaveValue(edited)
  })

  it('preserves a post-save edit when a deferred refetch arrives with the saved value', async () => {
    const user = userEvent.setup()
    const { settingsApi } = await import('@/api/settings')
    ;(settingsApi.getAgentsMd as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ content: 'A' })
      .mockResolvedValueOnce({ content: 'B' })
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const textarea = (await screen.findByLabelText('AGENTS.md content')) as HTMLTextAreaElement
    await waitFor(() => expect(textarea).toHaveValue('A'))
    fireEvent.change(textarea, { target: { value: 'B' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(settingsApi.updateAgentsMd).toHaveBeenCalledWith('B'))
    fireEvent.change(textarea, { target: { value: 'A' } })
    await waitFor(() => expect(settingsApi.getAgentsMd).toHaveBeenCalledTimes(2))
    expect(textarea).toHaveValue('A')
  })

  it('reports a save as applied without a restart', async () => {
    const user = userEvent.setup()
    const { settingsApi } = await import('@/api/settings')
    const { showToast } = await import('@/lib/toast')
    ;(settingsApi.updateAgentsMd as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, restartRequired: false })
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const textarea = (await screen.findByLabelText('AGENTS.md content')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '# Rules\n\napplied\n' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('AGENTS.md saved'))
  })

  it('requests a restart when the in-place reload fails', async () => {
    const user = userEvent.setup()
    const { settingsApi } = await import('@/api/settings')
    const { showToast } = await import('@/lib/toast')
    ;(settingsApi.updateAgentsMd as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, restartRequired: true })
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    const textarea = (await screen.findByLabelText('AGENTS.md content')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '# Rules\n\nneeds restart\n' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(showToast.success).toHaveBeenCalledWith(
        'Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.',
      ),
    )
  })

  it('reports resetting to default as applied without a restart', async () => {
    const user = userEvent.setup()
    const { settingsApi } = await import('@/api/settings')
    const { showToast } = await import('@/lib/toast')
    ;(settingsApi.updateAgentsMd as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, restartRequired: false })
    render(<AgentsMdEditor />, { wrapper: createWrapper() })
    await screen.findByLabelText('AGENTS.md content')
    await user.click(screen.getByRole('button', { name: 'Reset to Default' }))
    await waitFor(() => expect(showToast.success).toHaveBeenCalledWith('AGENTS.md reset to default'))
  })
})
