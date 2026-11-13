import { useState } from 'react'
import type { ComponentProps } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { buildServerDirectoryKey } from '@opencode-manager/shared/schemas'
import { ModelQuickSelect } from './ModelQuickSelect'
import { useModelStore, locationAgentKey } from '@/stores/modelStore'
import { installElementScrollMetrics, installWindowSize } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

type QuickSelectProps = ComponentProps<typeof ModelQuickSelect>

interface Selection {
  providerID: string
  modelID: string
}

interface CatalogModel {
  id: string
  providerID: string
  name: string
  contextLimit?: number
  released?: number
}

interface CatalogProvider {
  id: string
  name: string
  activation?: 'auto' | 'enabled' | 'disabled'
}

interface QuickState {
  favorite?: Selection[]
  recent?: Selection[]
  model?: Selection
  defaultModel?: Selection
  providers?: CatalogProvider[]
  models?: CatalogModel[]
}

const defaultProviders: CatalogProvider[] = [
  { id: 'opencode-go', name: 'OpenCode Go' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
]

const defaultModels: CatalogModel[] = [
  { id: 'go-1', providerID: 'opencode-go', name: 'Go Model One' },
  { id: 'zen-1', providerID: 'opencode', name: 'Zen One' },
  { id: 'claude-sonnet-4', providerID: 'anthropic', name: 'Claude Sonnet 4', contextLimit: 200000, released: 2 },
  { id: 'claude-opus-5-5-fast', providerID: 'anthropic', name: 'Claude Opus 5.5', contextLimit: 1000000, released: 1 },
  { id: 'gpt-5', providerID: 'openai', name: 'GPT-5' },
]

const modelDirectoryKey = locationAgentKey(buildServerDirectoryKey(LOCAL_OPENCODE_SERVER_ID, ''), undefined)

const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
})

afterAll(() => {
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
    return
  }
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
})

function rawModel(model: CatalogModel) {
  return {
    id: model.id,
    modelID: model.id,
    providerID: model.providerID,
    name: model.name,
    capabilities: {},
    enabled: true,
    status: 'active',
    limit: { context: model.contextLimit ?? 200000, output: 8192 },
    time: { released: model.released ?? 1 },
    cost: [{ input: 3, output: 15 }],
    variants: [],
  }
}

function selectionRoutes(state: QuickState): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: '/api/opencode/api/provider',
      respond: () => ({ json: { data: state.providers ?? defaultProviders } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/model',
      respond: () => ({ json: { data: (state.models ?? defaultModels).map(rawModel) } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/model/default',
      respond: () => ({ json: { data: state.defaultModel ?? null } }),
    },
    { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
    {
      method: 'GET',
      path: '/api/providers/model-state',
      respond: () => ({
        json: { favorite: state.favorite ?? [], recent: state.recent ?? [], variant: {} },
      }),
    },
    {
      method: 'POST',
      path: '/api/providers/model-state',
      respond: () => ({ json: { favorite: state.favorite ?? [], recent: state.recent ?? [], variant: {} } }),
    },
  ]
}

function QuickSelectHarness({
  initial,
  bind,
}: {
  initial: Partial<QuickSelectProps>
  bind: (update: (next: Partial<QuickSelectProps>) => void) => void
}) {
  const [props, setProps] = useState(initial)
  bind((next) => setProps((current) => ({ ...current, ...next })))
  return <ModelQuickSelect {...props} open={props.open ?? true} />
}

async function renderQuickSelect(props: Partial<QuickSelectProps> = {}, state: QuickState = {}) {
  if (state.model) useModelStore.setState({ newSessionPicks: { [modelDirectoryKey]: state.model } })
  let update: (next: Partial<QuickSelectProps>) => void = () => undefined
  const result = renderWithProviders(
    <QuickSelectHarness
      initial={props}
      bind={(nextUpdate) => {
        update = nextUpdate
      }}
    />,
    {
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: selectionRoutes(state),
    },
  )
  await waitFor(() => expect(result.fetchFake.lastRequest('GET', '/api/opencode/api/model')).toBeDefined())
  await waitFor(() => expect(result.queryClient.isFetching()).toBe(0))

  return {
    ...result,
    update: async (next: Partial<QuickSelectProps>) => {
      await act(async () => {
        update(next)
      })
    },
  }
}

function selection(providerID: string, modelID: string): Selection {
  return { providerID, modelID }
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
  return Array.from(root.querySelectorAll('*')).filter((element) =>
    DARK_ONLY_CLASS.test(element.getAttribute('class') ?? ''),
  )
}

async function openSelector(user: ReturnType<typeof userEvent.setup>, state: QuickState = {}) {
  renderWithProviders(
    <ModelQuickSelect>
      <span>Select model</span>
    </ModelQuickSelect>,
    { auth: false, theme: false, toaster: false, fetchRoutes: selectionRoutes(state) },
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

function mobileModelList() {
  const lists = Array.from(document.querySelectorAll('.overflow-y-auto.px-4.pb-4'))
  const list = lists.find((element) => !element.classList.contains('pt-2'))
  if (!list) throw new Error('No mobile model list found')
  return list
}

function lastModelStateRequest(fetchFake: ReturnType<typeof renderQuickSelect>['fetchFake']) {
  return fetchFake.lastRequest('POST', '/api/providers/model-state')?.body
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

describe('ModelQuickSelect controlled open', () => {
  it('uses the controlled open prop as the source of truth', async () => {
    const onOpenChange = vi.fn()
    const { update } = await renderQuickSelect({ open: false, onOpenChange })

    expect(screen.queryByRole('dialog', { name: 'Select model' })).not.toBeInTheDocument()

    await update({ open: true })

    expect(screen.getByRole('dialog', { name: 'Select model' })).toBeInTheDocument()
  })

  it('renders only the sheet without a trigger when no children are provided', async () => {
    await renderQuickSelect({ open: true })

    expect(screen.getByRole('dialog', { name: 'Select model' })).toBeInTheDocument()
    expect(document.querySelector('[data-model-select-trigger]')).toBeNull()
  })

  it('resets the internal navigation state when the sheet is closed through the component', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    await renderQuickSelect({ onOpenChange })

    await user.click(screen.getByRole('button', { name: /More models/ }))
    expect(screen.getByPlaceholderText('Search models...')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: /More models/ })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search models...')).not.toBeInTheDocument()
  })
})

describe('ModelQuickSelect quick view', () => {
  it('lists every valid favorite in catalog order', async () => {
    await renderQuickSelect({}, { favorite: [selection('anthropic', 'claude-sonnet-4'), selection('openai', 'gpt-5')] })

    const section = sectionFor('Favorites')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.textContent).toContain('GPT-5')
    expect(section.textContent!.indexOf('Claude Sonnet 4')).toBeLessThan(section.textContent!.indexOf('GPT-5'))
  })

  it('keeps a favorite listed when it is also the default model', async () => {
    await renderQuickSelect(
      {},
      {
        favorite: [selection('anthropic', 'claude-sonnet-4'), selection('openai', 'gpt-5')],
        defaultModel: selection('openai', 'gpt-5'),
      },
    )

    const section = sectionFor('Favorites')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.textContent).toContain('GPT-5')
  })

  it('lists the valid recents that are not favorites', async () => {
    await renderQuickSelect(
      {},
      {
        favorite: [selection('anthropic', 'claude-sonnet-4')],
        recent: [selection('anthropic', 'claude-sonnet-4'), selection('openai', 'gpt-5')],
      },
    )

    const section = sectionFor('Recent')
    expect(section.textContent).toContain('GPT-5')
    expect(section.textContent).not.toContain('Claude Sonnet 4')
  })

  it('keeps the active model listed with its check mark', async () => {
    await renderQuickSelect(
      {},
      {
        favorite: [selection('anthropic', 'claude-sonnet-4')],
        model: selection('anthropic', 'claude-sonnet-4'),
      },
    )

    const section = sectionFor('Favorites')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.querySelector('.text-highlight')).not.toBeNull()
  })

  it('shows the first catalog models under Models when there are no favorites or recents', async () => {
    await renderQuickSelect()

    const section = sectionFor('Models')
    expect(section.textContent).toContain('Go Model One')
    expect(section.textContent).toContain('Zen One')
    expect(section.textContent).toContain('Claude Sonnet 4')
    expect(section.textContent).not.toContain('GPT-5')
  })

  it('shows the catalog name of an active model whose provider is not in the provider sections', async () => {
    await renderQuickSelect(
      {},
      {
        providers: [...defaultProviders, { id: 'legacy', name: 'Legacy', activation: 'disabled' }],
        models: [...defaultModels, { id: 'gpt-5-legacy', providerID: 'legacy', name: 'GPT-5 Legacy' }],
        model: selection('legacy', 'gpt-5-legacy'),
      },
    )

    expect(screen.getByText('GPT-5 Legacy')).toBeInTheDocument()
  })

  it('writes the favorite and remove-recent changes to the server', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderQuickSelect(
      {},
      {
        favorite: [selection('anthropic', 'claude-sonnet-4')],
        recent: [selection('openai', 'gpt-5')],
      },
    )

    await user.click(screen.getByRole('button', { name: 'Remove from favorites' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toEqual({
        favorite: selection('anthropic', 'claude-sonnet-4'),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Remove from recent' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/providers/model-state')?.body).toEqual({
        removeRecent: selection('openai', 'gpt-5'),
      }),
    )
  })
})

describe('ModelQuickSelect more models', () => {
  it('lists providers in catalog order', async () => {
    const user = userEvent.setup()
    await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))

    const labels = ['OpenCode Go', 'OpenCode', 'Anthropic', 'OpenAI'].map(firstOf)
    for (let index = 1; index < labels.length; index += 1) {
      expect(isBefore(labels[index - 1], labels[index])).toBe(true)
    }
  })

  it('keeps a favorite visible in its provider list and count', async () => {
    const user = userEvent.setup()
    await renderQuickSelect({}, { favorite: [selection('openai', 'gpt-5')] })

    await user.click(screen.getByRole('button', { name: /More models/ }))

    const providerButton = screen.getAllByRole('button', { name: /OpenAI 1 model/ })[0]
    expect(providerButton).toBeInTheDocument()

    await user.click(providerButton)

    expect(screen.getAllByText('GPT-5').length).toBeGreaterThan(0)
  })

  it('searches into one flat list with favorites first', async () => {
    const user = userEvent.setup()
    await renderQuickSelect({}, { favorite: [selection('openai', 'gpt-5')] })

    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.type(screen.getByPlaceholderText('Search models...'), '5')

    const favorite = (await screen.findAllByText('GPT-5'))[0]
    const other = screen.getAllByText('Claude Opus 5.5')[0]

    expect(screen.getAllByText('GPT-5')).toHaveLength(1)
    expect(isBefore(favorite, other)).toBe(true)
  })

  it('scopes the search to the selected provider', async () => {
    const user = userEvent.setup()
    await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.click(screen.getAllByRole('button', { name: /Anthropic 2 models/ })[0])
    await user.type(screen.getByPlaceholderText('Search models...'), '5')

    expect((await screen.findAllByText('Claude Opus 5.5')).length).toBeGreaterThan(0)
    expect(screen.queryByText('GPT-5')).not.toBeInTheDocument()
  })

  it('selects a model and records it as recent', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderQuickSelect({}, { favorite: [selection('anthropic', 'claude-sonnet-4')] })

    const section = sectionFor('Favorites')
    await user.click(within(section).getByRole('button', { name: /Claude Sonnet 4/ }))

    expect(lastModelStateRequest(fetchFake)).toEqual({
      recent: selection('anthropic', 'claude-sonnet-4'),
    })
  })
})

describe('ModelQuickSelect keyboard navigation', () => {
  it('moves the active quick row with ArrowDown and selects it with Enter', async () => {
    const { fetchFake } = await renderQuickSelect({}, { model: selection('opencode-go', 'go-1') })

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)

    await waitFor(() =>
      expect(lastModelStateRequest(fetchFake)).toEqual({ recent: selection('opencode', 'zen-1') }),
    )
  })

  it('clamps at the first quick row and jumps to the last with End', async () => {
    const { fetchFake } = await renderQuickSelect({}, { model: selection('opencode-go', 'go-1') })

    const dialog = screen.getByRole('dialog', { name: 'Select model' })

    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    await waitFor(() =>
      expect(lastModelStateRequest(fetchFake)).toEqual({ recent: selection('opencode-go', 'go-1') }),
    )

    fetchFake.reset()

    fireEvent.keyDown(dialog, { key: 'End' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    await waitFor(() =>
      expect(lastModelStateRequest(fetchFake)).toEqual({ recent: selection('anthropic', 'claude-sonnet-4') }),
    )
  })

  it('navigates the search results with the arrow keys and Enter', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))
    const searchInput = screen.getByPlaceholderText('Search models...')
    await user.type(searchInput, '5')

    await screen.findAllByText('Claude Opus 5.5')

    expect(fireEvent.keyDown(searchInput, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(searchInput, { key: 'Enter' })).toBe(false)

    await waitFor(() => expect(lastModelStateRequest(fetchFake)).toEqual({ recent: selection('openai', 'gpt-5') }))
  })

  it('does not select a model when Enter is pressed on a row button', async () => {
    const { fetchFake } = await renderQuickSelect({}, { favorite: [selection('anthropic', 'claude-sonnet-4')] })

    const star = screen.getByRole('button', { name: /favorites/ })
    star.focus()

    fireEvent.keyDown(star, { key: 'Enter' })

    expect(lastModelStateRequest(fetchFake)).toBeUndefined()
  })

  it('does not intercept arrow keys when the sheet is closed', async () => {
    renderWithProviders(<ModelQuickSelect />, {
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: selectionRoutes({}),
    })

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(true)
  })

  it('ignores keyboard navigation when the mobile provider list hides the models', async () => {
    const user = userEvent.setup()
    installWindowSize(500)
    const { fetchFake } = await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(true)

    expect(lastModelStateRequest(fetchFake)).toBeUndefined()
  })

  it('navigates the provider models that are visible on mobile', async () => {
    const user = userEvent.setup()
    installWindowSize(500)
    const { fetchFake } = await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.click(screen.getAllByRole('button', { name: /Anthropic 2 models/ })[0])

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)

    await waitFor(() =>
      expect(lastModelStateRequest(fetchFake)).toEqual({
        recent: selection('anthropic', 'claude-opus-5-5-fast'),
      }),
    )
  })

  it('ignores keydown events while an IME composition is active', async () => {
    const { fetchFake } = await renderQuickSelect({}, { model: selection('opencode-go', 'go-1') })

    const textarea = focusDetachedTextarea()

    expect(fireEvent.keyDown(textarea, { key: 'ArrowDown', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })).toBe(true)

    expect(lastModelStateRequest(fetchFake)).toBeUndefined()
  })

  it('does not select while the deferred search query is still catching up', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))

    const searchInput = screen.getByPlaceholderText('Search models...')
    act(() => {
      fireEvent.change(searchInput, { target: { value: '5' } })
      fireEvent.keyDown(searchInput, { key: 'Enter' })
    })

    expect(lastModelStateRequest(fetchFake)).toBeUndefined()
  })

  it('scrolls the mobile provider model list to follow the active row', async () => {
    const user = userEvent.setup()
    installWindowSize(500)
    const scrollFake = installElementScrollMetrics({ clientHeight: 60 })
    await renderQuickSelect()

    await user.click(screen.getByRole('button', { name: /More models/ }))
    await user.click(screen.getAllByRole('button', { name: /Anthropic 2 models/ })[0])

    const list = mobileModelList()
    expect(scrollFake.getScrollTop(list)).toBe(0)

    const textarea = focusDetachedTextarea()
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })

    expect(scrollFake.getScrollTop(list)).toBe(60)
  })
})

describe('ModelQuickSelect context strip', () => {
  const session = { id: 'ses_1' }
  const usage = { totalTokens: 12000, usagePercentage: 6, contextLimit: 200000 }

  it('shows the used and limit tokens with the percentage and meter', async () => {
    await renderQuickSelect({ session, contextUsage: usage, onCompact: vi.fn() })

    const summary = screen.getByTestId('context-usage-summary')

    expect(summary).toHaveTextContent('12k / 200k · 6%')
    expect(summary).toHaveClass('text-success')
    expect(summary).toHaveAttribute('aria-label', 'context 6% used')
    expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '6%' })
  })

  it('tints the summary with the warning and destructive tones', async () => {
    const { update } = await renderQuickSelect({ session, contextUsage: { ...usage, usagePercentage: 60 } })
    expect(screen.getByTestId('context-usage-summary')).toHaveClass('text-warning')

    await update({ contextUsage: { ...usage, usagePercentage: 85 } })
    expect(screen.getByTestId('context-usage-summary')).toHaveClass('text-destructive')
  })

  it('compacts the session from the strip', async () => {
    const user = userEvent.setup()
    const onCompact = vi.fn()

    await renderQuickSelect({ session, contextUsage: usage, onCompact })

    await user.click(screen.getByRole('button', { name: 'Compact session' }))

    expect(onCompact).toHaveBeenCalledTimes(1)
  })

  it('disables compaction while compacting or without a session', async () => {
    const onCompact = vi.fn()
    const { update } = await renderQuickSelect({ session, contextUsage: usage, isCompacting: true, onCompact })

    expect(screen.getByRole('button', { name: 'Compact session' })).toBeDisabled()

    await update({ session: undefined })

    expect(screen.getByRole('button', { name: 'Compact session' })).toBeDisabled()
    expect(onCompact).not.toHaveBeenCalled()
  })

  it('falls back to tokens and an empty meter without a known limit', async () => {
    await renderQuickSelect({
      session,
      contextUsage: { totalTokens: 12000, usagePercentage: null, contextLimit: null },
    })

    expect(screen.getByTestId('context-usage-summary')).toHaveTextContent('12k tokens')
    expect(screen.getByTestId('context-usage-meter-fill')).toHaveStyle({ width: '0%' })
  })

  it('omits the strip without context usage', async () => {
    await renderQuickSelect({ session })

    expect(screen.queryByTestId('context-usage-strip')).not.toBeInTheDocument()
  })
})

describe('ModelQuickSelect model descriptions', () => {
  it('formats the context limit like the context strip', async () => {
    await renderQuickSelect({}, { model: selection('anthropic', 'claude-sonnet-4') })

    expect(screen.getByText('Anthropic · 200k context', { selector: 'p' })).toBeInTheDocument()
  })

  it('formats million-token limits without a trailing decimal', async () => {
    await renderQuickSelect({}, { model: selection('anthropic', 'claude-opus-5-5-fast') })

    expect(screen.getByText('Anthropic · 1M context', { selector: 'p' })).toBeInTheDocument()
  })
})

