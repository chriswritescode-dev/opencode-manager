import { describe, it, expect } from 'vitest'
import { getPermissionLabel, getPermissionDetail, getQuestionText } from '@opencode-manager/shared/notifications'
import { buildEventNotificationPayload, buildNotificationUrl } from '../../src/services/notification'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'

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
  it('formats a bash permission as "Run Command" title with repo-prefixed body', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash', metadata: { command: 'rm -rf node_modules' }, patterns: ['rm *'] } },
      ctx,
    )!
    expect(p.title).toBe('Run Command')
    expect(p.body).toBe('oc-manager · rm -rf node_modules')
    expect(p.tag).toBe('permission.asked-ses_1')
    expect(p.data?.eventType).toBe('permission.asked')
    expect(p.renotify).toBe(true)
    expect(typeof p.timestamp).toBe('number')
  })

  it('formats an edit permission with the file path', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'edit', metadata: { filePath: 'src/index.ts' } } },
      ctx,
    )!
    expect(p.title).toBe('Edit File')
    expect(p.body).toBe('oc-manager · src/index.ts')
  })

  it('uses "Approval required" body when no detail is available', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash' } },
      ctx,
    )!
    expect(p.body).toBe('oc-manager · Approval required')
  })

  it('formats a question as "Question" title with repo-prefixed body', () => {
    const p = buildEventNotificationPayload(
      { type: 'question.asked', properties: { questions: [{ question: 'Deploy to prod?' }] } },
      ctx,
    )!
    expect(p.title).toBe('Question')
    expect(p.body).toBe('oc-manager · Deploy to prod?')
  })

  it('formats session.error as "Error" title with repo-prefixed body', () => {
    const p = buildEventNotificationPayload(
      { type: 'session.error', properties: { error: { message: 'boom' } } },
      ctx,
    )!
    expect(p.title).toBe('Error')
    expect(p.body).toBe('oc-manager · boom')
  })

  it('formats session.idle as "Session complete" with repo-prefixed body', () => {
    const p = buildEventNotificationPayload({ type: 'session.idle', properties: {} }, ctx)!
    expect(p.title).toBe('Session complete')
    expect(p.body).toBe('oc-manager · Your session has finished processing')
  })

  it('omits the repo prefix when no repoName is provided', () => {
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash', metadata: { command: 'ls' } } },
      { url: '/' },
    )!
    expect(p.title).toBe('Run Command')
    expect(p.body).toBe('ls')
    expect(p.tag).toBe('permission.asked-global')
  })

  it('returns null for unknown event types', () => {
    expect(buildEventNotificationPayload({ type: 'session.created', properties: {} }, ctx)).toBeNull()
  })

  it('truncates the prefixed body to 140 chars with an ellipsis', () => {
    const long = 'x'.repeat(300)
    const p = buildEventNotificationPayload(
      { type: 'permission.asked', properties: { permission: 'bash', metadata: { command: long } } },
      ctx,
    )!
    expect(p.body.length).toBeLessThanOrEqual(140)
    expect(p.body.startsWith('oc-manager · ')).toBe(true)
    expect(p.body.endsWith('…')).toBe(true)
  })
})

describe('buildNotificationUrl', () => {
  it('returns "/" when repo is null', () => {
    expect(buildNotificationUrl(null, 'ses_1')).toBe('/')
  })
  it('returns the repo page when there is no session', () => {
    expect(buildNotificationUrl({ id: 5 }, undefined)).toBe('/repos/5')
  })
  it('returns the session page for a normal repo', () => {
    expect(buildNotificationUrl({ id: 5 }, 'ses_1')).toBe('/repos/5/sessions/ses_1')
  })
  it('appends ?assistant=1 for the assistant repo session', () => {
    expect(buildNotificationUrl({ id: ASSISTANT_REPO_ID }, 'ses_1')).toBe('/repos/0/sessions/ses_1?assistant=1')
  })
})
