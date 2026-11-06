import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeModelsEditor } from './OpenCodeModelsEditor'
import type { OpenCodeProviderConfig, OpenCodeProviderModelConfig } from '@opencode-manager/shared/opencode'
import { settingsApi } from '../../api/settings'

vi.mock('../../api/settings', () => ({
  settingsApi: {
    discoverOpenCodeModels: vi.fn(),
  },
}))

const mockProviders: Record<string, OpenCodeProviderConfig> = {
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
      render(<OpenCodeModelsEditor providers={{}} onSave={vi.fn()} />)

      expect(screen.getByText(/No models configured/)).toBeInTheDocument()
      expect(screen.getByText(/Add your first model to get started/)).toBeInTheDocument()
    })

    it('should render provider groups with model counts', () => {
      render(<OpenCodeModelsEditor providers={mockProviders} onSave={vi.fn()} />)

      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      const modelCountSpans = screen.getAllByText(/1 model/)
      expect(modelCountSpans.length).toBe(2)
    })

    it('should render model entries with display names and IDs', () => {
      render(<OpenCodeModelsEditor providers={mockProviders} onSave={vi.fn()} />)

      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
      expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument()
    })

    it('should render model limits when present', () => {
      render(<OpenCodeModelsEditor providers={mockProviders} onSave={vi.fn()} />)

      expect(screen.getByText(/Context 128000/)).toBeInTheDocument()
      expect(screen.getByText(/Output 4096/)).toBeInTheDocument()
    })
  })

  describe('delete model', () => {
    it('should save the full provider with the model key cleared', async () => {
      const onSave = vi.fn()
      const user = userEvent.setup()
      render(<OpenCodeModelsEditor providers={mockProviders} onSave={onSave} />)

      await user.click(screen.getByLabelText('Actions for GPT-4o'))
      await user.click(screen.getByText('Delete'))

      expect(onSave).toHaveBeenCalledWith({
        openai: {
          name: 'OpenAI',
          models: { 'gpt-4o': null },
        },
      })
    })
  })

  describe('rename model', () => {
    it('should save the new key and clear the old key in the same provider patch', async () => {
      const onSave = vi.fn()
      const user = userEvent.setup()
      render(<OpenCodeModelsEditor providers={mockProviders} onSave={onSave} />)

      await user.click(screen.getByText('GPT-4o'))

      fireEvent.change(document.querySelector('input[name="modelId"]') as HTMLInputElement, {
        target: { value: 'gpt-4o-renamed' },
      })
      await user.click(screen.getByRole('button', { name: /update/i }))

      expect(onSave).toHaveBeenCalledWith({
        openai: {
          name: 'OpenAI',
          models: {
            'gpt-4o-renamed': expect.objectContaining({ name: 'GPT-4o' }),
            'gpt-4o': null,
          },
        },
      })
    })
  })

  describe('v1-converted providers', () => {
    const convertedProviders: Record<string, OpenCodeProviderConfig> = {
      p: {
        name: 'Provider P',
        settings: { baseURL: 'http://x' },
        models: {
          a: { name: 'Model A' },
          b: { name: 'Model B' },
        },
      },
    }

    it('should keep the provider name, settings and sibling models when editing a model', async () => {
      const onSave = vi.fn()
      const user = userEvent.setup()
      render(<OpenCodeModelsEditor providers={convertedProviders} onSave={onSave} />)

      await user.click(screen.getByText('Model A'))
      fireEvent.change(document.querySelector('input[name="displayName"]') as HTMLInputElement, {
        target: { value: 'Model A Updated' },
      })
      await user.click(screen.getByRole('button', { name: /update/i }))

      expect(onSave).toHaveBeenCalledWith({
        p: {
          name: 'Provider P',
          settings: { baseURL: 'http://x' },
          models: {
            a: expect.objectContaining({ name: 'Model A Updated' }),
            b: { name: 'Model B' },
          },
        },
      })
    })

    it('should keep the provider name, settings and sibling models when deleting a model', async () => {
      const onSave = vi.fn()
      const user = userEvent.setup()
      render(<OpenCodeModelsEditor providers={convertedProviders} onSave={onSave} />)

      await user.click(screen.getByLabelText('Actions for Model A'))
      await user.click(screen.getByText('Delete'))

      expect(onSave).toHaveBeenCalledWith({
        p: {
          name: 'Provider P',
          settings: { baseURL: 'http://x' },
          models: {
            a: null,
            b: { name: 'Model B' },
          },
        },
      })
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

    it('should not render the removed status input', async () => {
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} />)

      expect(screen.queryByText('Status')).not.toBeInTheDocument()
      expect(document.querySelector('input[name="status"]')).toBeNull()
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with the v2 model patch', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      fireEvent.change(document.querySelector('input[name="modelId"]') as HTMLInputElement, {
        target: { value: 'gpt-5' },
      })
      fireEvent.change(document.querySelector('input[name="displayName"]') as HTMLInputElement, {
        target: { value: 'GPT-5' },
      })
      fireEvent.change(screen.getByPlaceholderText('e.g., MiniMax-M2.7'), {
        target: { value: 'gpt-5-backing' },
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-5',
          expect.objectContaining({
            modelID: 'gpt-5-backing',
            name: 'GPT-5',
          }),
        )
      })
    })

    it('should include limit data when provided', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      fireEvent.change(document.querySelector('input[name="modelId"]') as HTMLInputElement, {
        target: { value: 'gpt-5' },
      })
      fireEvent.change(document.querySelector('input[name="displayName"]') as HTMLInputElement, {
        target: { value: 'GPT-5' },
      })
      fireEvent.change(document.querySelector('input[name="contextLimit"]') as HTMLInputElement, {
        target: { value: '256000' },
      })
      fireEvent.change(document.querySelector('input[name="outputLimit"]') as HTMLInputElement, {
        target: { value: '8192' },
      })

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
          }),
        )
      })
    })

    it('should parse variants as a v2 array', async () => {
      const onSubmit = vi.fn()
      const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
      render(<OpenCodeModelDialog {...defaultProps} onSubmit={onSubmit} />)

      fireEvent.change(document.querySelector('input[name="modelId"]') as HTMLInputElement, {
        target: { value: 'gpt-5' },
      })
      fireEvent.change(document.querySelector('textarea[name="variantsJson"]') as HTMLTextAreaElement, {
        target: { value: '[{"id":"fast","settings":{"encoding":"fast"}}]' },
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-5',
          expect.objectContaining({
            variants: [{ id: 'fast', settings: { encoding: 'fast' } }],
          }),
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
          modelID: 'gpt-4o',
          name: 'GPT-4o',
          limit: { context: 128000, output: 4096 },
        } as OpenCodeProviderModelConfig,
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
      expect(document.querySelector('input[name="modelId"]')).toHaveValue('gpt-4o')
    })

    it('should emit Update button text when editing', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
        } as OpenCodeProviderModelConfig,
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

    it('should preserve the provider model id and advanced fields when renaming a model key', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          modelID: 'gpt-4o',
          name: 'GPT-4o',
          limit: { context: 128000, output: 4096 },
          body: { reasoning: true },
        } as OpenCodeProviderModelConfig,
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
            modelID: 'gpt-4o',
            name: 'GPT-4o',
            body: { reasoning: true },
          }),
        )
      })
    })

    it('should send nulls for nested limit and header keys cleared during an edit', async () => {
      const editingModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        model: {
          name: 'GPT-4o',
          limit: { context: 200000, input: 100000, output: 8000 },
          headers: { 'X-A': '1', 'X-B': '2' },
        } as OpenCodeProviderModelConfig,
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

      fireEvent.change(document.querySelector('input[name="inputLimit"]') as HTMLInputElement, {
        target: { value: '' },
      })
      fireEvent.change(document.querySelector('textarea[name="headersJson"]') as HTMLTextAreaElement, {
        target: { value: '{"X-A":"1"}' },
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /update/i })).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /update/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          'openai',
          'gpt-4o',
          expect.objectContaining({
            limit: { context: 200000, input: null, output: 8000 },
            headers: { 'X-A': '1', 'X-B': null },
          }),
        )
      })
    })
  })
})

describe('OpenCodeModelDialog — model discovery', () => {
  const discoveryProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    availableProviders: [],
    selectedProviderId: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(settingsApi.discoverOpenCodeModels).mockReset()
  })

  afterEach(() => {
    vi.mocked(settingsApi.discoverOpenCodeModels).mockReset()
  })

  it('shows a Discover button when a new API provider has a base URL', async () => {
    const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
    render(<OpenCodeModelDialog {...discoveryProps} />)

    const baseUrlInput = screen.getByPlaceholderText('e.g., https://api.openai.com/v1')
    fireEvent.change(baseUrlInput, { target: { value: 'http://localhost:1234' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /discover|refresh/i })).toBeInTheDocument()
    })
  })

  it('discovers models and shows the count when Discover is clicked', async () => {
    vi.mocked(settingsApi.discoverOpenCodeModels).mockResolvedValue({
      models: ['gpt-4o', 'gpt-3.5-turbo'],
      cached: false,
    })
    const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
    render(<OpenCodeModelDialog {...discoveryProps} />)

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    const discoverButton = await screen.findByRole('button', { name: /discover|refresh/i })
    fireEvent.click(discoverButton)

    await waitFor(() => {
      expect(screen.getByText(/2 models found/i)).toBeInTheDocument()
    })
    expect(settingsApi.discoverOpenCodeModels).toHaveBeenCalledWith('http://localhost:1234', undefined, true)
  })

  it('auto-populates config key and display name when selecting a discovered model', async () => {
    vi.mocked(settingsApi.discoverOpenCodeModels).mockResolvedValue({
      models: ['gpt-4o'],
      cached: false,
    })
    const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
    render(<OpenCodeModelDialog {...discoveryProps} />)

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    const discoverButton = await screen.findByRole('button', { name: /discover|refresh/i })
    fireEvent.click(discoverButton)

    await waitFor(() => {
      expect(screen.getByText(/1 model found/i)).toBeInTheDocument()
    })

    const providerModelInput = screen.getByPlaceholderText('e.g., MiniMax-M2.7')
    fireEvent.focus(providerModelInput)

    const option = await screen.findByRole('option', { name: 'gpt-4o' })
    fireEvent.click(option)

    const modelIdInput = document.querySelector('input[name="modelId"]') as HTMLInputElement
    const displayNameInput = document.querySelector('input[name="displayName"]') as HTMLInputElement
    expect(modelIdInput).toHaveValue('gpt-4o')
    expect(displayNameInput).toHaveValue('Gpt 4o')
  })

  it('shows an error message when discovery fails', async () => {
    vi.mocked(settingsApi.discoverOpenCodeModels).mockRejectedValue(new Error('network error'))
    const { OpenCodeModelDialog } = await import('./OpenCodeModelDialog')
    render(<OpenCodeModelDialog {...discoveryProps} />)

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    const discoverButton = await screen.findByRole('button', { name: /discover|refresh/i })
    fireEvent.click(discoverButton)

    await waitFor(() => {
      expect(screen.getByText(/failed to discover models/i)).toBeInTheDocument()
    })
  })
})
