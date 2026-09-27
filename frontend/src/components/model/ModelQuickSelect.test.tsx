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
    toggleFavorite: vi.fn(),
    removeRecentModel: vi.fn(),
  }),
}))

vi.mock('@/hooks/useVariants', () => ({
  useVariants: () => ({
    availableVariants: [],
    currentVariant: null,
    setVariant: vi.fn(),
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
            'claude-sonnet-4': {
              id: 'claude-sonnet-4',
              name: 'Claude Sonnet 4',
              limit: { context: 200000, output: 64000 },
            },
          },
        },
      ],
    },
  }),
}))

const DARK_ONLY_CLASS = /text-white|bg-zinc-950|bg-white\/|border-white\//

function darkOnlyClassNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('*'))
    .map((element) => (typeof element.className === 'string' ? element.className : ''))
    .filter((className) => DARK_ONLY_CLASS.test(className))
}

async function openModelSheet() {
  const user = userEvent.setup()
  render(
    <ModelQuickSelect>
      <span>Select model</span>
    </ModelQuickSelect>,
  )
  await user.click(screen.getByText('Select model'))
  const dialog = await screen.findByRole('dialog', { name: 'Select model' })
  return { user, dialog }
}

describe('ModelQuickSelect theming', () => {
  it('renders the quick model sheet with theme-aware surfaces', async () => {
    const { dialog } = await openModelSheet()

    expect(dialog.className).toContain('bg-popover')
    expect(dialog.className).not.toContain('bg-zinc-950')
    expect(darkOnlyClassNames(dialog)).toEqual([])
  })

  it('renders the More models action and provider list with theme-aware colors', async () => {
    const { user } = await openModelSheet()

    const moreModels = screen.getByRole('button', { name: /More models/ })
    expect(moreModels.className).toContain('text-foreground')
    expect(moreModels.className).not.toMatch(DARK_ONLY_CLASS)

    await user.click(moreModels)

    const dialog = screen.getByRole('dialog', { name: 'Select model' })
    expect(darkOnlyClassNames(dialog)).toEqual([])
  })
})
