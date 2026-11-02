import { describe, expect, it } from 'vitest'
import type { V2Event } from '@opencode-manager/shared/opencode'
import { createReplayEventBuilder, routeOpenCodeEvent } from '../../src/services/opencode-event-routing'

const locatedStatus = {
  id: 'evt_status_located',
  created: 1,
  type: 'session.status',
  location: { directory: '/work/alpha' },
  data: { sessionID: 'ses_1', status: { type: 'busy' } },
} satisfies V2Event

const unlocatedStatus = {
  id: 'evt_status_unlocated',
  created: 2,
  type: 'session.status',
  data: { sessionID: 'ses_1', status: { type: 'idle' } },
} satisfies V2Event

const forkedSession = {
  id: 'evt_forked',
  created: 3,
  type: 'session.forked',
  durable: { aggregateID: 'ses_1', seq: 1, version: 2 },
  data: {
    sessionID: 'ses_child',
    parentID: 'ses_1',
    boundary: { type: 'before', messageID: 'msg_1' },
  },
} satisfies V2Event

const childStatus = {
  id: 'evt_status_child',
  created: 4,
  type: 'session.status',
  data: { sessionID: 'ses_child', status: { type: 'busy' } },
} satisfies V2Event

const deletedSession = {
  id: 'evt_deleted',
  created: 5,
  type: 'session.deleted',
  durable: { aggregateID: 'ses_child', seq: 2, version: 2 },
  data: { sessionID: 'ses_child' },
} satisfies V2Event

describe('routeOpenCodeEvent', () => {
  it('serializes the event payload and remembers its directory by session', () => {
    const directories = new Map<string, string>()

    const routed = routeOpenCodeEvent(locatedStatus, directories)

    expect(routed.event).toBe(locatedStatus)
    expect(routed.payloadJson).toBe(JSON.stringify(locatedStatus))
    expect(routed.directory).toBe('/work/alpha')
    expect(routed.resolvedDirectory).toBe('/work/alpha')
    expect(directories.get('ses_1')).toBe('/work/alpha')
  })

  it('resolves a session directory remembered from an earlier event', () => {
    const directories = new Map<string, string>([['ses_1', '/work/alpha']])

    const routed = routeOpenCodeEvent(unlocatedStatus, directories)

    expect(routed.directory).toBeUndefined()
    expect(routed.resolvedDirectory).toBe('/work/alpha')
  })

  it('inherits the parent directory for a forked session', () => {
    const directories = new Map<string, string>([['ses_1', '/work/alpha']])

    const routed = routeOpenCodeEvent(forkedSession, directories)

    expect(routed.directory).toBeUndefined()
    expect(routed.resolvedDirectory).toBe('/work/alpha')
    expect(directories.get('ses_child')).toBe('/work/alpha')
  })

  it('forgets the directory of a deleted session', () => {
    const directories = new Map<string, string>([['ses_child', '/work/alpha']])

    const routed = routeOpenCodeEvent(deletedSession, directories)
    expect(routed.resolvedDirectory).toBe('/work/alpha')
    expect(directories.has('ses_child')).toBe(false)

    const afterDelete = routeOpenCodeEvent(childStatus, directories)
    expect(afterDelete.resolvedDirectory).toBeUndefined()
    expect(directories.has('ses_child')).toBe(false)
  })
})

describe('createReplayEventBuilder', () => {
  it('builds typed replay events with incremental ids', () => {
    const buildReplayEvent = createReplayEventBuilder('replay_')

    const permission = buildReplayEvent('permission.asked', '/work/alpha', {
      id: 'perm_1',
      sessionID: 'ses_1',
      action: 'edit',
      resources: ['/work/alpha/file.ts'],
    })
    const form = buildReplayEvent('form.created', '/work/alpha', {
      form: {
        id: 'form_1',
        sessionID: 'ses_1',
        title: 'Question',
        fields: [{ key: 'answer', type: 'string' }],
      },
    })
    const status = buildReplayEvent('session.status', '/work/alpha', {
      sessionID: 'ses_1',
      status: { type: 'idle' },
    })

    expect(permission.type).toBe('permission.asked')
    expect(permission.location?.directory).toBe('/work/alpha')
    expect(form.type).toBe('form.created')
    expect(status.type).toBe('session.status')
    expect([permission.id, form.id, status.id]).toEqual(['replay_1', 'replay_2', 'replay_3'])
  })
})
