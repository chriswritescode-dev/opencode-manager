import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorFindBar } from './editor-find-bar'

const baseProps = {
  query: '',
  onQueryChange: vi.fn(),
  matchCount: 0,
  currentMatch: 0,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  inputName: 'config-find',
}

describe('EditorFindBar', () => {
  it('hides the match counter when the query is empty', () => {
    render(<EditorFindBar {...baseProps} />)
    expect(screen.queryByTestId('find-match-count')).not.toBeInTheDocument()
  })

  it('reports the current match position', () => {
    render(<EditorFindBar {...baseProps} query="model" matchCount={3} currentMatch={2} />)
    expect(screen.getByTestId('find-match-count')).toHaveTextContent('2 of 3')
  })

  it('reports zero matches', () => {
    render(<EditorFindBar {...baseProps} query="zzz" matchCount={0} currentMatch={0} />)
    expect(screen.getByTestId('find-match-count')).toHaveTextContent('0 matches')
  })

  it('disables navigation when there are no matches', () => {
    render(<EditorFindBar {...baseProps} query="zzz" />)
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
  })

  it('advances on Enter and goes back on Shift+Enter', async () => {
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const user = userEvent.setup()
    render(<EditorFindBar {...baseProps} query="model" matchCount={2} currentMatch={1} onNext={onNext} onPrev={onPrev} />)
    const input = screen.getByRole('textbox', { name: 'Find in content' })
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(onNext).toHaveBeenCalledTimes(1)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('sizes navigation controls for touch on mobile', () => {
    render(<EditorFindBar {...baseProps} query="model" matchCount={1} currentMatch={1} />)
    const next = screen.getByRole('button', { name: 'Next match' })
    expect(next.className).toContain('size-10')
    expect(next.className).toContain('md:size-8')
  })

  it('uses a 16px input on mobile to prevent iOS zoom', () => {
    render(<EditorFindBar {...baseProps} />)
    expect(screen.getByRole('textbox', { name: 'Find in content' }).className).toContain('text-[16px]')
  })
})
