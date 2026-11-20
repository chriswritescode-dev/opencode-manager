import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/render'
import { UsageModelFilter } from './UsageModelFilter'

const models = ['anthropic/claude', 'openai/gpt', 'google/gemini']

function renderFilter(selected: string[] = [], onChange = vi.fn()) {
  const user = userEvent.setup()
  renderWithProviders(<UsageModelFilter models={models} selected={selected} onChange={onChange} />, {
    auth: false,
    theme: false,
    tts: false,
  })
  return { user, onChange }
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Filter by model' }))
}

describe('UsageModelFilter', () => {
  it('shows All models and no overflow badge when nothing is selected', () => {
    renderFilter()

    const trigger = screen.getByRole('button', { name: 'Filter by model' })

    expect(trigger).toHaveTextContent('All models')
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument()
  })

  it('shows the first selected model and the remaining count', () => {
    renderFilter(['anthropic/claude', 'openai/gpt', 'google/gemini'])

    const trigger = screen.getByRole('button', { name: 'Filter by model' })

    expect(trigger).toHaveTextContent('anthropic/claude')
    expect(trigger).toHaveTextContent('+2 more')
  })

  it('lists All models and every model key in the menu', async () => {
    const { user } = renderFilter()
    await openMenu(user)

    expect(await screen.findByRole('menuitemcheckbox', { name: /All models/ })).toBeInTheDocument()
    expect(await screen.findByRole('menuitemcheckbox', { name: 'anthropic/claude' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'openai/gpt' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'google/gemini' })).toBeInTheDocument()
  })

  it('adds an unselected model to the selection', async () => {
    const { user, onChange } = renderFilter(['anthropic/claude'])
    await openMenu(user)

    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'openai/gpt' }))

    expect(onChange).toHaveBeenCalledWith(['anthropic/claude', 'openai/gpt'])
  })

  it('removes an already-selected model from the selection', async () => {
    const { user, onChange } = renderFilter(['anthropic/claude', 'openai/gpt'])
    await openMenu(user)

    await user.click(await screen.findByRole('menuitemcheckbox', { name: /openai\/gpt/ }))

    expect(onChange).toHaveBeenCalledWith(['anthropic/claude'])
  })

  it('clears the selection when All models is clicked', async () => {
    const { user, onChange } = renderFilter(['anthropic/claude', 'openai/gpt'])
    await openMenu(user)

    await user.click(await screen.findByRole('menuitemcheckbox', { name: /All models/ }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('marks All models checked when the selection is empty', async () => {
    const { user } = renderFilter()
    await openMenu(user)

    expect(await screen.findByRole('menuitemcheckbox', { name: /All models/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('marks All models unchecked when models are selected', async () => {
    const { user } = renderFilter(['anthropic/claude'])
    await openMenu(user)

    expect(await screen.findByRole('menuitemcheckbox', { name: /All models/ })).toHaveAttribute('aria-checked', 'false')
  })
})
