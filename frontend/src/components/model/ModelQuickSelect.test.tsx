import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelQuickSelect } from './ModelQuickSelect'

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: () => ({
    model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
    modelString: 'anthropic/claude-sonnet-4',
    recentModels: [],
    favoriteModels: [],
    setModel: vi.fn(),
    setActiveModel: vi.fn(),
    restoreSessionModel: vi.fn(),
    toggleFavorite: vi.fn(),
    removeRecentModel: vi.fn(),
    isModelStateLoading: false,
  }),
}))

vi.mock('@/hooks/useVariants', () => ({
  useVariants: () => ({
    availableVariants: [],
    currentVariant: undefined,
    setVariant: vi.fn(),
    cycleVariant: vi.fn(),
    clearVariant: vi.fn(),
    hasVariants: false,
  }),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    data: {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          isConnected: true,
          models: {
            'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
          },
        },
      ],
    },
  }),
}))

const DARK_ONLY_CLASS = /text-white|bg-zinc-950|bg-white\/|border-white\//

function findDarkOnlyClassOffenders(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((element) =>
    DARK_ONLY_CLASS.test(element.getAttribute('class') ?? ''),
  )
}

async function openSelector(user: ReturnType<typeof userEvent.setup>) {
  render(
    <ModelQuickSelect>
      <span>Select model</span>
    </ModelQuickSelect>,
  )

  await user.click(screen.getByText('Select model'))

  return screen.findByRole('dialog', { name: 'Select model' })
}

describe('ModelQuickSelect theme tokens', () => {
  it('renders the quick view with theme tokens instead of dark-only classes', async () => {
    const user = userEvent.setup()
    const dialog = await openSelector(user)

    expect(dialog).toHaveClass('bg-popover')
    expect(findDarkOnlyClassOffenders(dialog)).toEqual([])

    const moreModels = screen.getByRole('button', { name: /More models/ })
    expect(moreModels).toHaveClass('text-foreground')
  })

  it('renders the provider view with theme tokens instead of dark-only classes', async () => {
    const user = userEvent.setup()
    const dialog = await openSelector(user)

    await user.click(screen.getByRole('button', { name: /More models/ }))

    expect(findDarkOnlyClassOffenders(dialog)).toEqual([])
  })
})
