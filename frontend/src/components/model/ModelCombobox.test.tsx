import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelCombobox } from './ModelCombobox'
import type { Provider } from '@/api/providers'

const mocks = vi.hoisted(() => ({
  useProviders: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  useOpenCodeDefaultModel: vi.fn(),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: mocks.useProviders,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
  useOpenCodeDefaultModel: mocks.useOpenCodeDefaultModel,
}))

const providers: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-5-5', key: 'claude-opus-5-5-fast', name: 'Claude Opus 5.5', released: 0, free: false },
      { id: 'claude-sonnet', key: 'claude-sonnet', name: 'Claude Sonnet', released: 0, free: false },
      { id: 'claude-haiku', key: 'claude-haiku', name: 'Claude Haiku', released: 0, free: false },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-5', key: 'gpt-5', name: 'GPT-5', released: 0, free: false },
      { id: 'gpt-4o', key: 'gpt-4o', name: 'GPT-4o', released: 0, free: false },
    ],
  },
]

describe('ModelCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProviders.mockReturnValue({ data: { providers, models: [] } })
    mocks.useOpenCodeModelState.mockReturnValue({
      data: {
        favorite: [{ providerID: 'anthropic', modelID: 'claude-sonnet' }],
        recent: [{ providerID: 'anthropic', modelID: 'claude-opus-5-5-fast' }],
        variant: {},
      },
    })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: 'openai/gpt-5' })
  })

  it('lists Default, Favorites, Recent, then providers in that order', async () => {
    const user = userEvent.setup()
    render(<ModelCombobox value="" onChange={vi.fn()} ariaLabel="Model" />)

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
    render(<ModelCombobox value="" onChange={onChange} ariaLabel="Model" />)

    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(screen.getByRole('option', { name: /Claude Opus 5\.5/ }))

    expect(onChange).toHaveBeenCalledWith('anthropic/claude-opus-5-5-fast')
  })

  it('clears the value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelCombobox value="anthropic/claude-sonnet" onChange={onChange} ariaLabel="Model" showClear />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('shows the resolved default model when the value is empty', () => {
    render(<ModelCombobox value="" onChange={vi.fn()} ariaLabel="Model" />)

    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('Default: GPT-5')
  })

  it('saves an empty value when the Default entry is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelCombobox value="" onChange={onChange} ariaLabel="Model" />)

    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(screen.getByRole('option', { name: 'Default: GPT-5' }))

    expect(onChange).toHaveBeenCalledWith('')
    expect(onChange).not.toHaveBeenCalledWith('openai/gpt-5')
  })
})
