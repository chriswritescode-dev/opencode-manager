import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelCombobox } from './ModelCombobox'
import type { FetchRoute } from '@/test/fetchFake'

const anthropicModels = [
  { id: 'claude-opus-5-5-fast', modelID: 'claude-opus-5-5', name: 'Claude Opus 5.5', providerID: 'anthropic' },
  { id: 'claude-sonnet', modelID: 'claude-sonnet', name: 'Claude Sonnet', providerID: 'anthropic' },
  { id: 'claude-haiku', modelID: 'claude-haiku', name: 'Claude Haiku', providerID: 'anthropic' },
]

const openaiModels = [
  { id: 'gpt-5', modelID: 'gpt-5', name: 'GPT-5', providerID: 'openai' },
  { id: 'gpt-4o', modelID: 'gpt-4o', name: 'GPT-4o', providerID: 'openai' },
]

function rawModel(model: { id: string, modelID: string, name: string, providerID: string }) {
  return {
    ...model,
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    variants: [],
    enabled: true,
    status: 'active',
    limit: { context: 200000, output: 64000 },
    time: { released: 1 },
    cost: [{ input: 3, output: 15 }],
  }
}

const routes: FetchRoute[] = [
  {
    method: 'GET',
    path: '/api/opencode/api/provider',
    respond: () => ({
      json: {
        data: [
          { id: 'anthropic', name: 'Anthropic', activation: 'enabled' },
          { id: 'openai', name: 'OpenAI', activation: 'enabled' },
        ],
      },
    }),
  },
  {
    method: 'GET',
    path: '/api/opencode/api/model',
    respond: () => ({ json: { data: [...anthropicModels, ...openaiModels].map(rawModel) } }),
  },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: { providerID: 'openai', id: 'gpt-5' } } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  {
    method: 'GET',
    path: '/api/providers/model-state',
    respond: () => ({
      json: {
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
        recent: [{ providerID: 'anthropic', modelID: 'claude-opus-5-5-fast' }],
        variant: {},
      },
    }),
  },
]

async function renderCombobox(props: { value: string, onChange?: (value: string) => void, showClear?: boolean }) {
  const result = renderWithProviders(
    <ModelCombobox
      value={props.value}
      onChange={props.onChange ?? vi.fn()}
      ariaLabel="Model"
      showClear={props.showClear}
    />,
    { auth: false, theme: false, toaster: false, fetchRoutes: routes },
  )
  await screen.findByRole('combobox', { name: 'Model' })
  return result
}

describe('ModelCombobox', () => {
  it('lists Default, Favorites, Recent, then providers in that order', async () => {
    const user = userEvent.setup()
    await renderCombobox({ value: '' })

    await user.click(screen.getByRole('combobox', { name: 'Model' }))

    const listbox = screen.getByRole('listbox')
    const titles = ['Default', 'Favorites', 'Recent', 'Anthropic', 'OpenAI'].map((title) =>
      within(listbox).getByText(title),
    )

    for (let index = 1; index < titles.length; index += 1) {
      const follows = titles[index - 1].compareDocumentPosition(titles[index]) & Node.DOCUMENT_POSITION_FOLLOWING
      expect(follows).toBeTruthy()
    }
  })

  it('selects an aliased model by its OpenCode key', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderCombobox({ value: '', onChange })

    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(screen.getByRole('option', { name: /Claude Opus 5\.5/ }))

    expect(onChange).toHaveBeenCalledWith('anthropic/claude-opus-5-5-fast')
  })

  it('clears the value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderCombobox({ value: 'anthropic/claude-sonnet', onChange, showClear: true })

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('shows the resolved default model when the value is empty', async () => {
    await renderCombobox({ value: '' })

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('Default: GPT-5'),
    )
  })

  it('saves an empty value when the Default entry is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderCombobox({ value: '', onChange })

    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(screen.getByRole('option', { name: 'Default: GPT-5' }))

    expect(onChange).toHaveBeenCalledWith('')
    expect(onChange).not.toHaveBeenCalledWith('openai/gpt-5')
  })
})
