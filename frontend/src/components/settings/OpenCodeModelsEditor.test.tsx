import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeModelsEditor } from './OpenCodeModelsEditor'
import type { ConfigProvider, ConfigModel } from './OpenCodeModelsEditor'

const mockProviders: Record<string, ConfigProvider> = {
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-4o': {
        name: 'GPT-4o',
        limit: { context: 128000, output: 4096 },
      },
    },
  },
  anthropic: {
    name: 'Anthropic',
    models: {
      'claude-3-5-sonnet': {
        name: 'Claude 3.5 Sonnet',
        limit: { context: 200000, output: 8192 },
      },
    },
  },
}

describe('OpenCodeModelsEditor', () => {
  describe('rendering', () => {
    it('should render empty state when no providers configured', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={{}} onChange={onChange} />)

      expect(screen.getByText(/No models configured/)).toBeInTheDocument()
      expect(screen.getByText(/Add your first model to get started/)).toBeInTheDocument()
    })

    it('should render provider groups with model counts', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      const modelCountSpans = screen.getAllByText(/1 model/)
      expect(modelCountSpans.length).toBe(2)
    })

    it('should render model entries with display names and IDs', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
      expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument()
    })

    it('should render model limits when present', () => {
      const onChange = vi.fn()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      expect(screen.getByText(/Context 128000/)).toBeInTheDocument()
      expect(screen.getByText(/Output 4096/)).toBeInTheDocument()
    })
  })

  describe('delete model', () => {
    it('should call onChange with updated providers when model is deleted', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<OpenCodeModelsEditor providers={mockProviders} onChange={onChange} />)

      await user.click(screen.getByLabelText('Actions for GPT-4o'))
      await user.click(screen.getByText('Delete'))

      expect(onChange).toHaveBeenCalled()
      const updatedProviders = onChange.mock.calls[0][0]
      expect(updatedProviders.openai).toBeDefined()
      expect(updatedProviders.openai.models).toBeDefined()
    })
  })

  describe('model content structure', () => {
    it('should preserve provider structure when models change', async () => {
      const onChange = vi.fn()
      const providersWithExtras: Record<string, ConfigProvider> = {
        openai: {
          name: 'OpenAI',
          api: 'https://api.openai.com',
          npm: '@opencode-manager/provider-openai',
          models: {
            'gpt-4o': {
              name: 'GPT-4o',
            },
          },
        },
      }

      const user = userEvent.setup()
      render(<OpenCodeModelsEditor providers={providersWithExtras} onChange={onChange} />)

      await user.click(screen.getByLabelText('Actions for GPT-4o'))
      await user.click(screen.getByText('Delete'))

      expect(onChange).toHaveBeenCalled()
      const updatedProviders = onChange.mock.calls[0][0]
      expect(updatedProviders.openai.name).toBe('OpenAI')
      expect(updatedProviders.openai.api).toBe('https://api.openai.com')
      expect(updatedProviders.openai.npm).toBe('@opencode-manager/provider-openai')
    })
  })
})

describe('OpenCodeModelDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    availableProviders: ['openai', 'anthropic'],
    selectedProviderId: 'openai',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('form validation', () => {
    it('should require model id when submitting empty form', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      const createButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText(/model id is required/i)).toBeInTheDocument()
      })
    })

    it('should disable create button when required fields are empty', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      await waitFor(() => {
        const createButton = screen.getByRole('button', { name: /create/i })
        expect(createButton).toBeDisabled()
      })
    })

    it('should validate model id format', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      expect(modelIdInput).not.toBeNull()
      fireEvent.change(modelIdInput, { target: { value: 'invalid model id!' } })

      await waitFor(() => {
        expect(screen.getByText(/must use only letters, numbers/i)).toBeInTheDocument()
      })
    })

    it('should preserve create form values when provider props refresh', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      const props = {
        ...defaultProps,
        availableProviders: ['openai'],
        existingProviders: { openai: { name: 'OpenAI' } },
      }
      const { rerender } = render(<OpenCodeModelDialog {...props} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      fireEvent.change(modelIdInput, { target: { value: 'gpt-5' } })

      rerender(
        <OpenCodeModelDialog
          {...props}
          availableProviders={['openai']}
          existingProviders={{ openai: { name: 'OpenAI' } }}
        />
      )

      expect(modelIdInput).toHaveValue('gpt-5')
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with correct provider id, model id, and model data', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      const displayNameInput = document.querySelector('input[name="displayName"]') as HTMLInputElement

      expect(modelIdInput).not.toBeNull()
      expect(displayNameInput).not.toBeNull()
      fireEvent.change(modelIdInput, { target: { value: 'gpt-5' } })
      fireEvent.change(displayNameInput, { target: { value: 'GPT-5' } })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-5',
          expect.objectContaining({
            name: 'GPT-5',
          })
        )
      })
    })

    it('should include limit data when provided', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
      const displayNameInput = document.querySelector('input[name="displayName"]') as HTMLInputElement
      const contextLimitInput = document.querySelector('input[name="contextLimit"]') as HTMLInputElement
      const outputLimitInput = document.querySelector('input[name="outputLimit"]') as HTMLInputElement

      expect(modelIdInput).not.toBeNull()
      expect(displayNameInput).not.toBeNull()
      expect(contextLimitInput).not.toBeNull()
      expect(outputLimitInput).not.toBeNull()

      fireEvent.change(modelIdInput, { target: { value: 'gpt-5' } })
      fireEvent.change(displayNameInput, { target: { value: 'GPT-5' } })
      fireEvent.change(contextLimitInput, { target: { value: '256000' } })
      fireEvent.change(outputLimitInput, { target: { value: '8192' } })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-5',
          expect.objectContaining({
            name: 'GPT-5',
            limit: {
              context: 256000,
              output: 8192,
            },
          })
        )
      })
    })
  })

  describe('edit mode', () => {
    it('should pre-fill form with existing model data', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
          limit: { context: 128000, output: 4096 },
        } as ConfigModel,
      }

      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(
        <OpenCodeModelDialog
          {...defaultProps}
          onSubmit={onSubmit}
          editingModel={editingModel}
          open={true}
        />
      )

      expect(screen.getByDisplayValue('GPT-4o')).toBeInTheDocument()
      expect(screen.getByDisplayValue('gpt-4o')).toBeInTheDocument()
    })

    it('should emit Update button text when editing', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
        } as ConfigModel,
      }

      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(
        <OpenCodeModelDialog
          {...defaultProps}
          editingModel={editingModel}
          open={true}
        />
      )

      expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument()
    })

    it('should preserve the original backing model id when renaming a model key', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          limit: { context: 128000, output: 4096 },
          reasoning: true,
        } as ConfigModel,
      }

      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(
        <OpenCodeModelDialog
          {...defaultProps}
          onSubmit={onSubmit}
          editingModel={editingModel}
          open={true}
        />
      )

      fireEvent.change(document.querySelector('input[name="modelId"]') as HTMLInputElement, {
        target: { value: 'my-friendly-model' },
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /update/i })).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /update/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'my-friendly-model',
          expect.objectContaining({
            id: 'gpt-4o',
            name: 'GPT-4o',
            reasoning: true,
          })
        )
      })
    })
  })
})
