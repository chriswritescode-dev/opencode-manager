import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeModelsEditor } from './OpenCodeModelsEditor'
import { OpenCodeModelDialog } from './OpenCodeModelDialog'
import type { OpenCodeProviderConfig } from '@opencode-manager/shared/opencode'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const mockProviders = {
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
} satisfies Record<string, OpenCodeProviderConfig>

function renderWithRoutes(ui: Parameters<typeof renderWithProviders>[0], fetchRoutes: FetchRoute[] = []) {
  return renderWithProviders(ui, { auth: false, theme: false, tts: false, fetchRoutes })
}

describe('OpenCodeModelsEditor', () => {
  describe('rendering', () => {
    it('should render empty state when no providers configured', () => {
      renderWithRoutes(<OpenCodeModelsEditor providers={{}} onSave={vi.fn()} />)

      expect(screen.getByText(/No models configured/)).toBeInTheDocument()
      expect(screen.getByText(/Add your first model to get started/)).toBeInTheDocument()
    })

    it('should render provider groups with model counts', () => {
      renderWithRoutes(<OpenCodeModelsEditor providers={mockProviders} onSave={vi.fn()} />)

      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      expect(screen.getAllByText(/1 model/)).toHaveLength(2)
    })

    it('should render model entries with display names and IDs', () => {
      renderWithRoutes(<OpenCodeModelsEditor providers={mockProviders} onSave={vi.fn()} />)

      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
      expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
      expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument()
    })

    it('should render model limits when present', () => {
      renderWithRoutes(<OpenCodeModelsEditor providers={mockProviders} onSave={vi.fn()} />)

      expect(screen.getByText(/Context 128000/)).toBeInTheDocument()
      expect(screen.getByText(/Output 4096/)).toBeInTheDocument()
    })
  })

  describe('delete model', () => {
    it('should save the full provider with the model key cleared', async () => {
      const onSave = vi.fn()
      const user = userEvent.setup()
      renderWithRoutes(<OpenCodeModelsEditor providers={mockProviders} onSave={onSave} />)

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
      renderWithRoutes(<OpenCodeModelsEditor providers={mockProviders} onSave={onSave} />)

      await user.click(screen.getByText('GPT-4o'))

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'gpt-4o-renamed' } })
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
    const convertedProviders = {
      p: {
        name: 'Provider P',
        settings: { baseURL: 'http://x' },
        models: {
          a: { name: 'Model A' },
          b: { name: 'Model B' },
        },
      },
    } satisfies Record<string, OpenCodeProviderConfig>

    it('should keep the provider name, settings and sibling models when editing a model', async () => {
      const onSave = vi.fn()
      const user = userEvent.setup()
      renderWithRoutes(<OpenCodeModelsEditor providers={convertedProviders} onSave={onSave} />)

      await user.click(screen.getByText('Model A'))
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Model A Updated' } })
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
      renderWithRoutes(<OpenCodeModelsEditor providers={convertedProviders} onSave={onSave} />)

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

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  onSubmit: vi.fn(),
  availableProviders: ['openai', 'anthropic'],
  selectedProviderId: 'openai',
}

function renderDialog(overrides: Partial<Parameters<typeof OpenCodeModelDialog>[0]> = {}, fetchRoutes: FetchRoute[] = []) {
  return renderWithRoutes(<OpenCodeModelDialog {...defaultProps} {...overrides} />, fetchRoutes)
}

describe('OpenCodeModelDialog', () => {
  describe('form validation', () => {
    it('should require model id when submitting empty form', async () => {
      renderDialog()

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(screen.getByText(/model id is required/i)).toBeInTheDocument()
      })
    })

    it('should disable create button when required fields are empty', async () => {
      renderDialog()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
      })
    })

    it('should validate model id format', async () => {
      renderDialog()

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'invalid model id!' } })

      await waitFor(() => {
        expect(screen.getByText(/must use only letters, numbers/i)).toBeInTheDocument()
      })
    })

    it('should preserve create form values when provider props refresh', async () => {
      function DialogHarness({ existingProviders }: { existingProviders: Record<string, OpenCodeProviderConfig> }) {
        return (
          <OpenCodeModelDialog
            {...defaultProps}
            availableProviders={['openai']}
            existingProviders={existingProviders}
          />
        )
      }
      const existingProviders = { openai: { name: 'OpenAI' } }
      const { rerender } = render(<DialogHarness existingProviders={existingProviders} />)

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'gpt-5' } })

      rerender(<DialogHarness existingProviders={{ openai: { name: 'OpenAI' } }} />)

      expect(screen.getByLabelText('Config Key')).toHaveValue('gpt-5')
    })

    it('should not render the removed status input', async () => {
      renderDialog()

      expect(screen.queryByText('Status')).not.toBeInTheDocument()
      expect(document.querySelector('input[name="status"]')).toBeNull()
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with the v2 model patch', async () => {
      const onSubmit = vi.fn()
      renderDialog({ onSubmit })

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'gpt-5' } })
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'GPT-5' } })
      fireEvent.change(screen.getByPlaceholderText('e.g., MiniMax-M2.7'), { target: { value: 'gpt-5-backing' } })

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
      renderDialog({ onSubmit })

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'gpt-5' } })
      fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'GPT-5' } })
      fireEvent.change(screen.getByLabelText('Context Limit'), { target: { value: '256000' } })
      fireEvent.change(screen.getByLabelText('Output Limit'), { target: { value: '8192' } })

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
      renderDialog({ onSubmit })

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'gpt-5' } })
      fireEvent.change(screen.getByLabelText('Variants JSON'), {
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
      renderDialog({
        editingModel: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          model: {
            modelID: 'gpt-4o',
            name: 'GPT-4o',
            limit: { context: 128000, output: 4096 },
          },
        },
      })

      expect(screen.getByDisplayValue('GPT-4o')).toBeInTheDocument()
      expect(screen.getByLabelText('Config Key')).toHaveValue('gpt-4o')
    })

    it('should emit Update button text when editing', async () => {
      renderDialog({
        editingModel: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          model: { name: 'GPT-4o' },
        },
      })

      expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument()
    })

    it('should preserve the provider model id and advanced fields when renaming a model key', async () => {
      const onSubmit = vi.fn()
      renderDialog({
        onSubmit,
        editingModel: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          model: {
            modelID: 'gpt-4o',
            name: 'GPT-4o',
            limit: { context: 128000, output: 4096 },
            body: { reasoning: true },
          },
        },
      })

      fireEvent.change(screen.getByLabelText('Config Key'), { target: { value: 'my-friendly-model' } })

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
      const onSubmit = vi.fn()
      renderDialog({
        onSubmit,
        editingModel: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          model: {
            name: 'GPT-4o',
            limit: { context: 200000, input: 100000, output: 8000 },
            headers: { 'X-A': '1', 'X-B': '2' },
          },
        },
      })

      fireEvent.change(screen.getByLabelText('Input Limit'), { target: { value: '' } })
      fireEvent.change(screen.getByLabelText('Headers JSON'), { target: { value: '{"X-A":"1"}' } })

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

const discoveryProps = {
  open: true,
  onOpenChange: vi.fn(),
  onSubmit: vi.fn(),
  availableProviders: [],
  selectedProviderId: '',
}

function discoveryRoute(respond: () => FetchRouteResult | Promise<FetchRouteResult>): FetchRoute {
  return { method: 'GET', path: '/api/settings/opencode-discover-models', respond }
}

function renderDiscovery(respond: () => FetchRouteResult | Promise<FetchRouteResult>) {
  return renderDialog(discoveryProps, [discoveryRoute(respond)])
}

describe('OpenCodeModelDialog — model discovery', () => {
  it('shows a Discover button when a new API provider has a base URL', async () => {
    renderDiscovery(() => ({ json: { models: [], cached: false } }))

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    expect(await screen.findByRole('button', { name: /discover|refresh/i })).toBeInTheDocument()
  })

  it('discovers models and shows the count when Discover is clicked', async () => {
    const { fetchFake } = renderDiscovery(() => ({ json: { models: ['gpt-4o', 'gpt-3.5-turbo'], cached: false } }))

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /discover|refresh/i }))

    expect(await screen.findByText(/2 models found/i)).toBeInTheDocument()
    const request = fetchFake.lastRequest('GET', '/api/settings/opencode-discover-models')
    expect(request?.searchParams.get('baseUrl')).toBe('http://localhost:1234')
    expect(request?.searchParams.get('refresh')).toBe('true')
  })

  it('auto-populates config key and display name when selecting a discovered model', async () => {
    renderDiscovery(() => ({ json: { models: ['gpt-4o'], cached: false } }))

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /discover|refresh/i }))
    expect(await screen.findByText(/1 model found/i)).toBeInTheDocument()

    const providerModelInput = screen.getByPlaceholderText('e.g., MiniMax-M2.7')
    fireEvent.focus(providerModelInput)
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-4o' }))

    expect(screen.getByLabelText('Config Key')).toHaveValue('gpt-4o')
    expect(screen.getByPlaceholderText('e.g., Qwen3.5-27B')).toHaveValue('Gpt 4o')
  })

  it('shows an error message when discovery fails', async () => {
    renderDiscovery(() => {
      throw new Error('network error')
    })

    fireEvent.change(screen.getByPlaceholderText('e.g., https://api.openai.com/v1'), {
      target: { value: 'http://localhost:1234' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /discover|refresh/i }))

    expect(await screen.findByText(/failed to discover models/i)).toBeInTheDocument()
  })
})
