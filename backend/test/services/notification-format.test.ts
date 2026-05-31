import { describe, it, expect } from 'vitest'
import { getPermissionLabel, getPermissionDetail, getQuestionText } from '@opencode-manager/shared/notifications'
import { buildEventNotificationPayload } from '../../src/services/notification'

const ctx = { repoName: 'oc-manager', repoId: 1, sessionId: 'ses_1', directory: '/abs/repo', url: '/repos/1/sessions/ses_1' }

describe('getPermissionLabel', () => {
  it('maps known permission types to friendly labels', () => {
    expect(getPermissionLabel('bash')).toBe('Run Command')
    expect(getPermissionLabel('webfetch')).toBe('Fetch URL')
    expect(getPermissionLabel('edit')).toBe('Edit File')
  })
  it('capitalizes unknown types', () => {
    expect(getPermissionLabel('frobnicate')).toBe('Frobnicate')
  })
})

describe('getPermissionDetail', () => {
  it('returns the bash command', () => {
    expect(getPermissionDetail({ permission: 'bash', metadata: { command: 'rm -rf node_modules' } }).primary).toBe('rm -rf node_modules')
  })
  it('returns the edited file path with a diff secondary', () => {
    const detail = getPermissionDetail({ permission: 'edit', metadata: { filePath: 'src/index.ts', diff: 'a\nb' } })
    expect(detail.primary).toBe('src/index.ts')
    expect(detail.secondary).toBe('a\nb')
  })
  it('returns the fetched url', () => {
    expect(getPermissionDetail({ permission: 'webfetch', metadata: { url: 'https://example.com' } }).primary).toBe('https://example.com')
  })
  it('falls back to patterns when metadata is missing', () => {
    expect(getPermissionDetail({ permission: 'bash', patterns: ['git *'] }).primary).toBe('git *')
  })
  it('returns empty primary when no detail available', () => {
    expect(getPermissionDetail({ permission: 'bash' }).primary).toBe('')
  })
})

describe('getQuestionText', () => {
  it('returns the first question text', () => {
    expect(getQuestionText({ questions: [{ question: 'Deploy to prod?' }] })).toBe('Deploy to prod?')
  })
  it('returns empty string when no questions', () => {
    expect(getQuestionText({ questions: [] })).toBe('')
    expect(getQuestionText({})).toBe('')
  })
})

describe('buildEventNotificationPayload', () => {
  it('formats a bash permission as "{repo}: Run Command" + command body', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash', metadata: { command: 'rm -rf node_modules' }, patterns: ['rm *'] } },
      ctx,
    )!
    expect(p.title).toBe('oc-manager: Run Command')
    expect(p.body).toBe('rm -rf node_modules')
    expect(p.tag).toBe('permission.asked-ses_1')
    expect(p.data?.eventType).toBe('permission.asked')
  })

  it('formats an edit permission with the file path', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'edit', metadata: { filePath: 'src/index.ts' } } },
      ctx,
    )!
    expect(p.title).toBe('oc-manager: Edit File')
    expect(p.body).toBe('src/index.ts')
  })

  it('uses "Approval required" body when no detail is available', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash' } },
      ctx,
    )!
    expect(p.body).toBe('Approval required')
  })

  it('formats a question as "{repo}: Question" + question text body', () => {
    const p = buildEventNotificationPayload(
      { type: 'question.asked', properties: { questions: [{ question: 'Deploy to prod?' }] } },
      ctx,
    )!
    expect(p.title).toBe('oc-manager: Question')
    expect(p.body).toBe('Deploy to prod?')
  })

  it('formats session.error as "{repo}: Error" + error message', () => {
    const p = buildEventNotificationPayload(
      { type: 'session.error', properties: { error: { message: 'boom' } } },
      ctx,
    )!
    expect(p.title).toBe('oc-manager: Error')
    expect(p.body).toBe('boom')
  })

  it('formats session.idle as "{repo}: Session complete"', () => {
    const p = buildEventNotificationPayload({ type: 'session.idle', properties: {} }, ctx)!
    expect(p.title).toBe('oc-manager: Session complete')
    expect(p.body).toBe('Your session has finished processing')
  })

  it('omits the repo prefix when no repoName is provided', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash', metadata: { command: 'ls' } } },
      { url: '/' },
    )!
    expect(p.title).toBe('Run Command')
    expect(p.tag).toBe('permission.asked-global')
  })

  it('returns null for unknown event types', () => {
    expect(buildEventNotificationPayload({ type: 'session.created', properties: {} }, ctx)).toBeNull()
  })

  it('truncates bodies longer than 140 chars with an ellipsis', () => {
    const long = 'x'.repeat(300)
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash', metadata: { command: long } } },
      ctx,
    )!
    expect(p.body.length).toBeLessThanOrEqual(140)
    expect(p.body.endsWith('…')).toBe(true)
  })
})
