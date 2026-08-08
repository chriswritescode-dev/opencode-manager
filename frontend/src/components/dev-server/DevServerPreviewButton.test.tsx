import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DevServerPreviewButton } from './DevServerPreviewButton'
import { useMutation } from '@tanstack/react-query'

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
}))

vi.mock('@/api/devServer', () => ({
  getDevServerStatus: vi.fn(),
}))

describe('DevServerPreviewButton', () => {
  it('calls onOpen with devserver input when configured port is running', () => {
    const onOpen = vi.fn()

    type RunningState = { status: 'running'; port: number; previewUrl: string }
    let capturedOnSuccess: ((state: RunningState) => void) | undefined
    vi.mocked(useMutation).mockImplementation(((options: { onSuccess?: (state: RunningState) => void }) => {
      capturedOnSuccess = options.onSuccess
      return {
        mutate: () => capturedOnSuccess?.({ status: 'running', port: 5100, previewUrl: 'http://manager.example:3056/' }),
        isPending: false,
      } as unknown as ReturnType<typeof useMutation>
    }) as typeof useMutation)

    render(<DevServerPreviewButton repoId={3} onOpen={onOpen} />)

    const button = screen.getByLabelText('Open app preview')
    expect(button).toBeInTheDocument()

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith({
      source: 'devserver',
      previewUrl: 'http://manager.example:3056/',
      title: 'App preview',
    })
  })

  it('disables button while pending', () => {
    const onOpen = vi.fn()
    vi.mocked(useMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useMutation>)

    render(<DevServerPreviewButton repoId={1} onOpen={onOpen} />)

    const button = screen.getByLabelText('Open app preview')
    expect(button).toBeDisabled()
  })
})
