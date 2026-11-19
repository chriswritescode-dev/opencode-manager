import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { AgentInfo, SkillInfo } from '@opencode-manager/shared/opencode'
import { makeAgent, promptTextarea, renderPromptInput } from '@/test/promptInput'

const reviewerAgent: AgentInfo = makeAgent({ id: 'reviewer', description: 'Reviewer' })
const prReviewSkill: SkillInfo = { id: 'pr-review', name: 'PR Review', description: 'Review a PR', path: '/skills/pr-review/SKILL.md', content: '' }

function selectedSuggestionLabel(): string {
  const list = screen.getByTestId('prompt-suggestions')
  for (const row of list.querySelectorAll('[data-index]')) {
    const button = row.querySelector('button')
    if (!button) continue
    const isSelected = button.className.split(/\s+/).some((token) => token === 'bg-primary' || token === 'bg-primary/15')
    if (isSelected) return button.textContent ?? ''
  }
  return ''
}

describe('PromptInput agent mention submission', () => {
  it('sends an @agent mention as an attachment without switching the session agent', async () => {
    const { fetchFake } = await renderPromptInput({ agents: [reviewerAgent], sessionAgent: 'build' })

    fireEvent.change(promptTextarea(), { target: { value: 'ask @reviewer' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
      text: 'ask @reviewer',
      agents: [{ name: 'reviewer', mention: { start: 4, end: 13, text: '@reviewer' } }],
    })
    expect(fetchFake.findRequests('POST', '/api/opencode/api/session/test-session/agent')).toHaveLength(0)
  })

  it('queues an @agent mention as an attachment while a response streams', async () => {
    const { fetchFake } = await renderPromptInput({ agents: [reviewerAgent], isStreamingResponse: true })

    fireEvent.change(promptTextarea(), { target: { value: 'ask @reviewer' } })
    fireEvent.click(screen.getByTitle('Queue message'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
      text: 'ask @reviewer',
      agents: [{ name: 'reviewer', mention: { start: 4, end: 13, text: '@reviewer' } }],
      delivery: 'queue',
    })
  })

  it('sends an @skill mention as a skill attachment', async () => {
    const { fetchFake } = await renderPromptInput({ skills: [prReviewSkill] })

    fireEvent.change(promptTextarea(), { target: { value: 'use @pr-review and @pr-review' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
      text: 'use @pr-review and @pr-review',
      agents: [],
      skills: [{ id: 'pr-review', mention: { start: 4, end: 14, text: '@pr-review' } }],
    })
  })

  it('sends plain text without an agent attachment', async () => {
    const { fetchFake } = await renderPromptInput({ agents: [reviewerAgent], sessionAgent: 'build' })

    fireEvent.change(promptTextarea(), { target: { value: 'plain text' } })
    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')).toBeDefined())
    expect(fetchFake.lastRequest('POST', '/api/opencode/api/session/test-session/prompt')?.body).toMatchObject({
      text: 'plain text',
      agents: [],
    })
  })

  it.each([
    [true, 'ArrowUp', 'ArrowDown'],
    [false, 'ArrowDown', 'ArrowUp'],
  ])('moves the mention selection with the arrows (mobile: %s)', async (mobile, forward, backward) => {
    await renderPromptInput({
      mobile,
      agents: [
        makeAgent({ id: 'alpha', description: 'Alpha agent' }),
        makeAgent({ id: 'beta', description: 'Beta agent' }),
      ],
    })

    fireEvent.change(promptTextarea(), { target: { value: '@', selectionStart: 1 } })

    await waitFor(() => expect(screen.getByTestId('prompt-suggestions')).toBeInTheDocument())
    expect(selectedSuggestionLabel()).toContain('alpha')

    fireEvent.keyDown(promptTextarea(), { key: forward })
    await waitFor(() => expect(selectedSuggestionLabel()).toContain('beta'))

    fireEvent.keyDown(promptTextarea(), { key: backward })
    await waitFor(() => expect(selectedSuggestionLabel()).toContain('alpha'))
  })

  it('offers only mentionable subagents in the @ list', async () => {
    await renderPromptInput({
      agents: [
        makeAgent({ id: 'build', description: 'Build', mode: 'primary' }),
        makeAgent({ id: 'plan', description: 'Plan', mode: 'primary' }),
        makeAgent({ id: 'explore', description: 'Explore' }),
        makeAgent({ id: 'general', description: 'General', mode: 'all' }),
        makeAgent({ id: 'Compaction', description: 'Compaction', mode: 'primary', hidden: true }),
        makeAgent({ id: 'Title', description: 'Title', mode: 'primary', hidden: true }),
      ],
      skills: [],
    })

    fireEvent.change(promptTextarea(), { target: { value: '@', selectionStart: 1 } })

    await waitFor(() => expect(screen.getByTestId('prompt-suggestions')).toBeInTheDocument())
    const labels = Array.from(screen.getByTestId('prompt-suggestions').querySelectorAll('button')).map(
      (button) => button.textContent,
    )
    expect(labels).toHaveLength(2)
    expect(labels[0]).toContain('explore')
    expect(labels[1]).toContain('general')
  })
})
