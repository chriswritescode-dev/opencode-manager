import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useUIState } from '@/stores/uiStateStore'
import {
  installElementScrollMetrics,
  installMatchMedia,
  installResizeObserver,
  installWindowSize,
} from '@/test/browserFakes'
import { makeUserMessage } from '@/test/fixtures/api'
import { promptTextarea } from '@/test/promptInput'
import { renderSessionPage } from '@/test/sessionPage'
import type { ElementScrollMetricsFake, ResizeObserverFake } from '@/test/browserFakes'
import type { FetchRouteResult } from '@/test/fetchFake'

const TRANSCRIPT_SCROLL_HEIGHT = 1000
const TRANSCRIPT_VIEWPORT_HEIGHT = 300
const TRANSCRIPT_SCROLLED_UP_POSITION = 300
const PROMPT_OVERLAY_HEIGHT = 140
const PROMPT_OVERLAY_CLEARANCE_PX = 16

async function waitForComposer() {
  await screen.findByTestId('prompt-overlay')
  await waitFor(() => {
    expect(document.querySelector('[data-prompt-input]')).not.toBeNull()
  })
}

function transcriptContainer() {
  return screen.getByTestId('session-message-scroll')
}

function paddingBottom() {
  return transcriptContainer().style.paddingBottom
}

function floatingStopButton() {
  const button = screen.getAllByTitle('Stop').find((candidate) => candidate.classList.contains('md:hidden'))
  if (!button) throw new Error('the floating stop button is not rendered')
  return button
}

let scrollMetrics: ElementScrollMetricsFake
let resizeObserver: ResizeObserverFake

function transcriptScrollTop() {
  return scrollMetrics.getScrollTop(transcriptContainer())
}

function scrollUpInTranscript() {
  scrollMetrics.setScrollTop(transcriptContainer(), TRANSCRIPT_SCROLLED_UP_POSITION)
  fireEvent.wheel(transcriptContainer(), { deltaY: -200 })
}

describe('SessionDetail scroll and composer affordances', () => {
  beforeEach(() => {
    installMatchMedia(false)
    resizeObserver = installResizeObserver()
    scrollMetrics = installElementScrollMetrics({
      scrollHeight: TRANSCRIPT_SCROLL_HEIGHT,
      clientHeight: TRANSCRIPT_VIEWPORT_HEIGHT,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { name: 'mobile', width: 480 },
    { name: 'desktop', width: 900 },
  ])('shows jump to latest after scrolling up on $name', async ({ width }) => {
    installWindowSize(width)
    renderSessionPage()
    await waitForComposer()

    scrollUpInTranscript()

    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument()
  })

  it('keeps jump to latest visible while the composer has content', async () => {
    renderSessionPage()
    await waitForComposer()

    fireEvent.change(promptTextarea(), { target: { value: 'hello' } })
    scrollUpInTranscript()

    expect(await screen.findByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument()
  })

  it('hides jump to latest while the transcript is at the bottom', async () => {
    renderSessionPage()
    await waitForComposer()
    scrollMetrics.setScrollTop(transcriptContainer(), TRANSCRIPT_SCROLL_HEIGHT)

    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument()
  })

  it('scrolls the transcript back to the bottom when jump to latest is clicked', async () => {
    renderSessionPage()
    await waitForComposer()
    scrollUpInTranscript()

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument()
    })
    expect(transcriptScrollTop()).toBe(TRANSCRIPT_SCROLL_HEIGHT)
  })

  it.each([
    { name: 'shows the clear button for composer content while the session is idle', activeSessions: [], clears: true },
    { name: 'hides the clear button for composer content while the session is active', activeSessions: ['session-1'], clears: false },
  ])('$name', async ({ activeSessions, clears }) => {
    renderSessionPage({ activeSessions })
    await waitForComposer()

    fireEvent.change(promptTextarea(), { target: { value: 'hello' } })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear' }) !== null).toBe(clears)
    })
  })

  it('interrupts the active session from the floating stop button', async () => {
    const { fetchFake } = renderSessionPage({ activeSessions: ['session-1'] })
    await waitForComposer()
    await screen.findAllByTitle('Stop')

    fireEvent.click(floatingStopButton())

    await waitFor(() => {
      expect(
        fetchFake.findRequests('POST', /\/api\/opencode\/api\/session\/session-1\/interrupt$/),
      ).toHaveLength(1)
    })
  })

  it('shows the floating stop button while the session is active', async () => {
    renderSessionPage({ activeSessions: ['session-1'] })
    await waitForComposer()
    await screen.findAllByTitle('Stop')

    expect(floatingStopButton()).toBeInTheDocument()
  })

  it('hides the stop button while the session is idle', async () => {
    renderSessionPage()
    await waitForComposer()

    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument()
  })

  it('keeps the composer usable while the live stream is down', async () => {
    const { eventStream } = renderSessionPage()
    await waitForComposer()

    expect(eventStream?.openedUrls.length).toBeGreaterThan(0)
    expect(promptTextarea()).toBeEnabled()
  })

  it('keeps message list clearance when the prompt overlay remounts after a message edit', async () => {
    renderSessionPage()
    await waitForComposer()

    resizeObserver.reportHeight(PROMPT_OVERLAY_HEIGHT)
    const clearance = `${PROMPT_OVERLAY_HEIGHT + PROMPT_OVERLAY_CLEARANCE_PX}px`
    expect(paddingBottom()).toBe(clearance)

    act(() => {
      useUIState.setState({ isEditingMessage: true })
    })

    await waitFor(() => {
      expect(paddingBottom()).toBe(`${PROMPT_OVERLAY_CLEARANCE_PX}px`)
    })

    act(() => {
      useUIState.setState({ isEditingMessage: false })
    })

    await waitFor(() => expect(screen.getByTestId('prompt-overlay')).toBeInTheDocument())
    resizeObserver.reportHeight(PROMPT_OVERLAY_HEIGHT)

    expect(paddingBottom()).toBe(clearance)
  })

  it('scrolls to the bottom only once the transcript content is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let resolveMessages = (_result: FetchRouteResult) => {}
    const messageRespond = () => new Promise<FetchRouteResult>((resolve) => {
      resolveMessages = resolve
    })

    renderSessionPage({ messageRespond })
    await waitForComposer()

    expect(transcriptScrollTop()).toBe(0)

    resolveMessages({ json: { data: [makeUserMessage({ id: 'msg_1', text: 'Ready now' })], cursor: {} } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(await screen.findByText('Ready now')).toBeInTheDocument()
    expect(transcriptContainer().scrollTop).toBe(TRANSCRIPT_SCROLL_HEIGHT)
  })
})
