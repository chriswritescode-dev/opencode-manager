import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelQuickSelect } from './ModelQuickSelect'
import { buildModelSections } from '@/lib/modelSections'
import type { ModelInfo } from '@opencode-manager/shared/opencode'
import type { Provider } from '@/api/providers'

const mocks = vi.hoisted(() => ({
  useModelSelection: vi.fn(),
  useModelSections: vi.fn(),
  deferredSearchValue: { current: null as string | null },
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useDeferredValue: (value: string) => mocks.deferredSearchValue.current ?? value,
  }
})

vi.mock('@/hooks/useModelSelection', () => ({
  useModelSelection: mocks.useModelSelection,
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

vi.mock('@/hooks/useModelSections', () => ({
  useModelSections: mocks.useModelSections,
}))

const providers: Provider[] = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    models: [{ id: 'go-1', key: 'go-1', name: 'Go Model One', released: 0, free: false }],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    models: [{ id: 'zen-1', key: 'zen-1', name: 'Zen One', released: 0, free: false }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4', key: 'claude-sonnet-4', name: 'Claude Sonnet 4', released: 0, free: false },
      { id: 'claude-opus-5-5', key: 'claude-opus-5-5-fast', name: 'Claude Opus 5.5', released: 0, free: false },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [{ id: 'gpt-5', key: 'gpt-5', name: 'GPT-5', released: 0, free: false }],
  },
]

interface Selection {
  providerID: string
  modelID: string
}

function selection(providerID: string, modelID: string): Selection {
  return { providerID, modelID }
}

interface SelectionOptions {
  favorite?: Selection[]
  recent?: Selection[]
  model?: Selection | null
  info?: ModelInfo
  defaultModel?: string
}

function setModelSelection(options: SelectionOptions = {}) {
  const favorite = options.favorite ?? []
  const recent = options.recent ?? []
  const model = options.model ?? null
  const setModel = vi.fn()
  const toggleFavorite = vi.fn()
  const removeRecentModel = vi.fn()
  const modelState = { favorite, recent, variant: {} }

  mocks.useModelSelection.mockReturnValue({
    model,
    modelString: model ? `${model.providerID}/${model.modelID}` : null,
    info: options.info,
    activeAgent: null,
    recentModels: recent,
    favoriteModels: favorite,
    configured: null,
    modelState,
    setModel,
    setActiveAgent: vi.fn(),
    toggleFavorite,
    removeRecentModel,
    isModelReady: true,
  })

  mocks.useModelSections.mockReturnValue({
    providers,
    sections: buildModelSections(providers, modelState, options.defaultModel),
    defaultModel: options.defaultModel ?? null,
    modelState,
    isLoading: false,
  })

  return { setModel, toggleFavorite, removeRecentModel }
}

function sectionFor(title: string) {
  const heading = screen.getByText(title)
  const section = heading.closest('section')
  if (!section) throw new Error(`No section for ${title}`)
  return section
}

function firstOf(name: string) {
  return screen.getAllByText(name)[0]
}

function isBefore(first: HTMLElement, second: HTMLElement) {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

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

function focusDetachedTextarea() {
  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  textarea.focus()
  return textarea
}

const originalInnerWidth = window.innerWidth

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

function mobileModelList() {
  const lists = Array.from(document.querySelectorAll<HTMLElement>('.overflow-y-auto.px-4.pb-4'))
  const list = lists.find((element) => !element.classList.contains('pt-2'))
  if (!list) throw new Error('No mobile model list found')
  return list
}

afterEach(() => {
  document.querySelectorAll('textarea').forEach((element) => element.remove())
  setViewportWidth(originalInnerWidth)
  mocks.deferredSearchValue.current = null
})

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  setModelSelection()
})

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

describe('ModelQuickSelect controlled open', () => {
  it('uses the controlled open prop as the source of truth', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(<ModelQuickSelect open={false} onOpenChange={onOpenChange} />)

    expect(screen.queryByRole('dialog', { name: 'Select model' })).not.toBeInTheDocument()

    rerender(<ModelQuickSelect open onOpenChange={onOpenChange} />)

    expect(screen.getByRole('dialog', { name: 'Select model' })).toBeInTheDocument()
  })

  it('renders only the sheet without a trigger when no children are provided', () => {
    render(<ModelQuickSelect open />)

    expect(screen.getByRole('dialog', { name: 'Select model' })).toBeInTheDocument()
    expect(document.querySelector('[data-model-select-trigger]')).toBeNull()
  })

  it('resets the internal navigation state when the sheet is closed through the component', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ModelQuickSelect open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: /More models/ }))
    expect(screen.getByPlaceholderText('Search models...')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: /More models/ })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search models...')).not.toBeInTheDocument()
  })
})

describe('ModelQuickSelect quick view', () => {
  it('lists every valid favorite in model.json order', () => {
    setModelSelection({ favorite: [selection('anthropic', 'claude-sonnet-4'), selection('openai', 'gpt-5')] })

    render(<ModelQuickSelect open />)

    const section = sectionFor('Favorites')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.textContent).toContain('GPT-5')
    expect(section.textContent!.indexOf('Claude Sonnet 4')).toBeLessThan(section.textContent!.indexOf('GPT-5'))
  })

  it('keeps a favorite listed when it is also the default model', () => {
    setModelSelection({
      favorite: [selection('anthropic', 'claude-sonnet-4'), selection('openai', 'gpt-5')],
      defaultModel: 'openai/gpt-5',
    })

    render(<ModelQuickSelect open />)

    const section = sectionFor('Favorites')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.textContent).toContain('GPT-5')
  })

  it('lists the valid recents that are not favorites', () => {
    setModelSelection({
      favorite: [selection('anthropic', 'claude-sonnet-4')],
      recent: [selection('anthropic', 'claude-sonnet-4'), selection('openai', 'gpt-5')],
    })

    render(<ModelQuickSelect open />)

    const section = sectionFor('Recent')
    expect(section.textContent).toContain('GPT-5')
    expect(section.textContent).not.toContain('Claude Sonnet 4')
  })

  it('keeps the active model listed with its check mark', () => {
    setModelSelection({
      favorite: [selection('anthropic', 'claude-sonnet-4')],
      model: selection('anthropic', 'claude-sonnet-4'),
    })

    render(<ModelQuickSelect open />)

    const section = sectionFor('Favorites')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.querySelector('.text-highlight')).not.toBeNull()
  })

  it('shows the first catalog models under Models when there are no favorites or recents', () => {
    render(<ModelQuickSelect open />)

    const section = sectionFor('Models')
    expect(section.textContent).toContain('Go Model One')
    expect(section.textContent).toContain('Zen One')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.textContent).not.toContain('GPT-5')
  })

  it('shows the catalog name of an active model that is not in the provider sections', () => {
    setModelSelection({
      model: selection('openai', 'gpt-5-legacy'),
      info: { providerID: 'openai', id: 'gpt-5-legacy', name: 'GPT-5 Legacy' } as ModelInfo,
    })

    render(<ModelQuickSelect open />)

    expect(screen.getByText('GPT-5 Legacy')).toBeInTheDocument()
  })

  it('calls the favorite and remove-recent handlers', async () => {
    const user = userEvent.setup()
    const { toggleFavorite, removeRecentModel } = setModelSelection({
      favorite: [selection('anthropic', 'claude-sonnet-4')],
      recent: [selection('openai', 'gpt-5')],
    })

    render(<ModelQuickSelect open />)

    await user.click(screen.getByRole('button', { name: 'Remove from favorites' }))
    expect(toggleFavorite).toHaveBeenCalledWith(selection('anthropic', 'claude-sonnet-4'))

    await user.click(screen.getByRole('button', { name: 'Remove from recent' }))
    expect(removeRecentModel).toHaveBeenCalledWith(selection('openai', 'gpt-5'))
  })
})

describe('ModelQuickSelect more models', () => {
  it('lists providers in catalog order', async () => {
    const user = userEvent.setup()
    render(<ModelQuickSelect open />)

    await user.click(screen.getByRole('button', { name: /More models/ }))

    const labels = ['OpenCode Go', 'OpenCode', 'Anthropic', 'OpenAI'].map(firstOf)
    for (let index = 1; index < labels.length; index += 1) {
      expect(isBefore(labels[index - 1], labels[index])).toBe(true)
    }
  })

  it('keeps a favorite visible in its provider list and count', async () => {
    const user = userEvent.setup()
    setModelSelection({ favorite: [selection('openai', 'gpt-5')] })

    render(<ModelQuickSelect open />)

    await user.click(screen.getByRole('button', { name: /More models/ }))

    const providerButton = screen.getAllByRole('button', { name: /OpenAI 1 model/ })[0]
    expect(providerButton).toBeInTheDocument()

    await user.click(providerButton)

    expect(screen.getAllByText('GPT-5').length).toBeGreaterThan(0)
  })

  it('searches into one flat list with favorites first', async () => {
    const user = userEvent.setup()
    setModelSelection({ favorite: [selection('openai', 'gpt-5')] })

    render(<ModelQuickSelect open />)

    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.type(screen.getByPlaceholderText('Search models...'), '5')

    const favorite = (await screen.findAllByText('GPT-5'))[0]
    const other = screen.getAllByText('Claude Opus 5.5')[0]

    expect(screen.getAllByText('GPT-5')).toHaveLength(1)
    expect(isBefore(favorite, other)).toBe(true)
  })

  it('scopes the search to the selected provider', async () => {
    const user = userEvent.setup()
    render(<ModelQuickSelect open />)

    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.click(screen.getAllByRole('button', { name: /Anthropic 2 models/ })[0])
    await user.type(screen.getByPlaceholderText('Search models...'), '5')

    expect((await screen.findAllByText('Claude Opus 5.5')).length).toBeGreaterThan(0)
    expect(screen.queryByText('GPT-5')).not.toBeInTheDocument()
  })

  it('selects a model and closes the sheet', async () => {
    const user = userEvent.setup()
    const { setModel } = setModelSelection({ favorite: [selection('anthropic', 'claude-sonnet-4')] })

    render(<ModelQuickSelect open />)

    const section = sectionFor('Favorites')
    await user.click(within(section).getByRole('button', { name: /Claude Sonnet 4/ }))

    expect(setModel).toHaveBeenCalledWith(selection('anthropic', 'claude-sonnet-4'))
  })
})

describe('ModelQuickSelect keyboard navigation', () => {
  it('moves the active quick row with ArrowDown and selects it with Enter', () => {
    const { setModel } = setModelSelection({ model: selection('opencode-go', 'go-1') })

    render(<ModelQuickSelect open />)

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)

    expect(setModel).toHaveBeenCalledWith(selection('opencode', 'zen-1'))
  })

  it('clamps at the first quick row and jumps to the last with End', () => {
    const { setModel } = setModelSelection({ model: selection('opencode-go', 'go-1') })

    render(<ModelQuickSelect open />)

    const dialog = screen.getByRole('dialog', { name: 'Select model' })

    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(setModel).toHaveBeenLastCalledWith(selection('opencode-go', 'go-1'))

    setModel.mockClear()

    fireEvent.keyDown(dialog, { key: 'End' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(setModel).toHaveBeenCalledWith(selection('anthropic', 'claude-sonnet-4'))
  })

  it('navigates the search results with the arrow keys and Enter', async () => {
    const user = userEvent.setup()
    const { setModel } = setModelSelection()

    render(<ModelQuickSelect open />)

    await user.click(screen.getByRole('button', { name: /More models/ }))
    const searchInput = screen.getByPlaceholderText('Search models...')
    await user.type(searchInput, '5')

    await screen.findAllByText('Claude Opus 5.5')

    expect(fireEvent.keyDown(searchInput, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(searchInput, { key: 'Enter' })).toBe(false)

    expect(setModel).toHaveBeenCalledWith(selection('openai', 'gpt-5'))
  })

  it('does not select a model when Enter is pressed on a row button', () => {
    const { setModel } = setModelSelection({ favorite: [selection('anthropic', 'claude-sonnet-4')] })

    render(<ModelQuickSelect open />)

    const star = screen.getByRole('button', { name: /favorites/ })
    star.focus()

    fireEvent.keyDown(star, { key: 'Enter' })

    expect(setModel).not.toHaveBeenCalled()
  })

  it('does not intercept arrow keys when the sheet is closed', () => {
    render(<ModelQuickSelect />)

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(true)
  })

  it('ignores keyboard navigation when the mobile provider list hides the models', async () => {
    const user = userEvent.setup()
    const { setModel } = setModelSelection()
    setViewportWidth(500)

    render(<ModelQuickSelect open />)
    await user.click(screen.getByRole('button', { name: /More models/ }))

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(true)

    expect(setModel).not.toHaveBeenCalled()
  })

  it('navigates the provider models that are visible on mobile', async () => {
    const user = userEvent.setup()
    const { setModel } = setModelSelection()
    setViewportWidth(500)

    render(<ModelQuickSelect open />)
    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.click(screen.getAllByRole('button', { name: /Anthropic 2 models/ })[0])

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)

    expect(setModel).toHaveBeenCalledWith(selection('anthropic', 'claude-opus-5-5-fast'))
  })

  it('ignores keydown events while an IME composition is active', () => {
    const { setModel } = setModelSelection({ model: selection('opencode-go', 'go-1') })

    render(<ModelQuickSelect open />)

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })).toBe(true)

    expect(setModel).not.toHaveBeenCalled()
  })

  it('does not select while the deferred search query is still catching up', async () => {
    const user = userEvent.setup()
    const { setModel } = setModelSelection()

    render(<ModelQuickSelect open />)
    await user.click(screen.getByRole('button', { name: /More models/ }))

    const searchInput = screen.getByPlaceholderText('Search models...')
    mocks.deferredSearchValue.current = ''
    await user.type(searchInput, '5')

    expect(fireEvent.keyDown(searchInput, { key: 'Enter' })).toBe(false)

    expect(setModel).not.toHaveBeenCalled()
  })

  it('scrolls the mobile provider model list to follow the active row', async () => {
    const user = userEvent.setup()
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 60 })
    setViewportWidth(500)

    try {
      render(<ModelQuickSelect open />)
      await user.click(screen.getByRole('button', { name: /More models/ }))
      await user.click(screen.getAllByRole('button', { name: /Anthropic 2 models/ })[0])

      const list = mobileModelList()
      expect(list.scrollTop).toBe(0)

      const textarea = focusDetachedTextarea()
      fireEvent.keyDown(textarea, { key: 'ArrowDown' })

      expect(list.scrollTop).toBe(60)
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight!)
    }
  })
})
