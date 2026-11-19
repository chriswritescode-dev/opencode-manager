import { describe, expect, it } from 'vitest'
import { formatRunDuration, formatScheduleInbox, matchesScheduleJobSearch } from '@/components/schedules/schedule-utils'
import type { ScheduleJob } from '@opencode-manager/shared/types'
import { makeScheduleJob } from '@/test/fixtures/api'

describe('formatRunDuration', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatRunDuration({ startedAt: 0, finishedAt: 45_000 })).toBe('45s')
    expect(formatRunDuration({ startedAt: 0, finishedAt: 192_000 })).toBe('3m 12s')
    expect(formatRunDuration({ startedAt: 0, finishedAt: 3_840_000 })).toBe('1h 4m')
  })

  it('measures running runs against now', () => {
    expect(formatRunDuration({ startedAt: 1_000, finishedAt: null }, 31_000)).toBe('30s')
  })
})

describe('formatScheduleInbox', () => {
  it('labels every run versus failures only', () => {
    expect(formatScheduleInbox(true)).toBe('Every run')
    expect(formatScheduleInbox(false)).toBe('Failures only')
  })
})

describe('matchesScheduleJobSearch', () => {
  const job: ScheduleJob & { repoName: string } = {
    ...makeScheduleJob({ name: 'Docs drift review', description: 'Check README drift', repoId: 3 }),
    repoName: 'vllm',
  }

  it('matches name, description, and repo case-insensitively', () => {
    expect(matchesScheduleJobSearch(job, 'DRIFT')).toBe(true)
    expect(matchesScheduleJobSearch(job, 'readme')).toBe(true)
    expect(matchesScheduleJobSearch(job, 'vllm')).toBe(true)
    expect(matchesScheduleJobSearch(job, 'triage')).toBe(false)
  })

  it('matches everything for a blank term', () => {
    expect(matchesScheduleJobSearch(job, '   ')).toBe(true)
  })
})
