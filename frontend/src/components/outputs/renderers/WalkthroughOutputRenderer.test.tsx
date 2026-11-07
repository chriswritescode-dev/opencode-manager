import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WalkthroughOutputDataSchema } from '@opencode-manager/shared/schemas'
import type { ChangeHunk, WalkthroughOutputData } from '@opencode-manager/shared/schemas'
import { WalkthroughOutputRenderer } from './WalkthroughOutputRenderer'

const STOP_HUNK: ChangeHunk = {
  id: 'hunk-app',
  file: 'src/app.ts',
  status: 'modified',
  header: '@@ -1,2 +1,3 @@',
  text: '@@ -1,2 +1,3 @@\n context\n+added line',
  truncated: false,
  additions: 1,
  deletions: 0,
}

const OTHER_HUNK: ChangeHunk = {
  id: 'hunk-other',
  file: 'docs/README.md',
  status: 'deleted',
  header: '@@ -1 +0,0 @@',
  text: '',
  truncated: false,
  additions: 0,
  deletions: 3,
}

function walkthrough(): WalkthroughOutputData {
  return WalkthroughOutputDataSchema.parse({
    title: 'Walkthrough title',
    summary: 'Summary text explaining the change.',
    stops: [
      {
        id: 'stop-1',
        title: 'Core logic',
        explanation: 'Explanation of the core logic.',
        hunks: [STOP_HUNK],
      },
    ],
    otherHunks: [OTHER_HUNK],
    risks: ['A risk to watch'],
    testing: 'Run the tests.',
  })
}

describe('WalkthroughOutputRenderer', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the title, summary, stops, risks and testing', () => {
    render(<WalkthroughOutputRenderer data={walkthrough()} />)

    expect(screen.getByRole('heading', { name: 'Walkthrough title' })).toBeInTheDocument()
    expect(screen.getByText('Summary text explaining the change.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '1. Core logic' })).toBeInTheDocument()
    expect(screen.getByText('Explanation of the core logic.')).toBeInTheDocument()
    expect(screen.getByText('A risk to watch')).toBeInTheDocument()
    expect(screen.getByText('Run the tests.')).toBeInTheDocument()
  })

  it('opens a hunk at the clicked line', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(<WalkthroughOutputRenderer data={walkthrough()} onOpenFile={onOpenFile} />)

    await user.click(screen.getByText('added line'))

    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts', 2)
  })

  it('opens the file without a line when its name is clicked', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(<WalkthroughOutputRenderer data={walkthrough()} onOpenFile={onOpenFile} />)

    await user.click(screen.getByRole('button', { name: 'src/app.ts' }))

    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts')
    expect(onOpenFile.mock.calls[0]).toHaveLength(1)
  })

  it('keeps other changes collapsed until expanded', async () => {
    const user = userEvent.setup()
    render(<WalkthroughOutputRenderer data={walkthrough()} />)

    const summary = screen.getByText('Other changes (1)')
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    expect(screen.getByText('(+0/−3)')).toBeInTheDocument()

    await user.click(summary)

    expect(details?.open).toBe(true)
    expect(screen.getByRole('button', { name: 'docs/README.md' })).toBeInTheDocument()
  })

  it('scrolls to a stop when its table-of-contents button is clicked', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<WalkthroughOutputRenderer data={walkthrough()} />)

    await user.click(screen.getByRole('button', { name: '1. Core logic' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('renders the invalid-data message for invalid or missing data', () => {
    const { unmount } = render(<WalkthroughOutputRenderer data={{ title: 'Only a title' }} />)
    expect(screen.getByText("This output's data is invalid")).toBeInTheDocument()

    unmount()
    render(<WalkthroughOutputRenderer data={undefined} />)
    expect(screen.getByText("This output's data is invalid")).toBeInTheDocument()
  })

  it('shows a script tag in an explanation as text without injecting it', () => {
    const data = WalkthroughOutputDataSchema.parse({
      title: 'Script title',
      summary: 'Summary text.',
      stops: [
        {
          id: 'stop-script',
          title: 'Script stop',
          explanation:
            'Intro text before the script. <script>globalThis.__walkthroughPwned = true</script> Outro text.',
          hunks: [],
        },
      ],
      otherHunks: [],
    })
    const { container } = render(<WalkthroughOutputRenderer data={data} />)

    expect(screen.getByText(/Intro text before the script/)).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect((globalThis as { __walkthroughPwned?: boolean }).__walkthroughPwned).toBeUndefined()
  })
})
