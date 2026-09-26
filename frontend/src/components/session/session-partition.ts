import type { Session } from '@/api/types'

export interface PartitionedSessions {
  pinned: Session[]
  today: Session[]
  older: Session[]
}

export interface SelectRootSessionsOptions {
  directories?: ReadonlySet<string>
  keyFn: (session: Session) => string
}

export function selectRootSessions(
  sessions: Session[],
  options: SelectRootSessionsOptions,
): Session[] {
  const { directories, keyFn } = options
  const roots = sessions.filter((session) => {
    if (session.parentID) return false
    const directory = session.location.directory
    if (directories && directories.size > 0 && directory && !directories.has(directory)) return false
    return true
  })

  const uniqueSessions = new Map<string, Session>()
  for (const session of roots) {
    const key = keyFn(session)
    if (!uniqueSessions.has(key)) {
      uniqueSessions.set(key, session)
    }
  }

  return Array.from(uniqueSessions.values()).sort((a, b) => b.time.updated - a.time.updated)
}

export function partitionSessions(
  sessions: Session[],
  pinnedKeys: ReadonlySet<string>,
  keyFn: (session: Session) => string,
  now: number = Date.now(),
): PartitionedSessions {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const startMs = startOfDay.getTime()
  const byUpdatedDesc = (a: Session, b: Session) => b.time.updated - a.time.updated

  const pinned: Session[] = []
  const today: Session[] = []
  const older: Session[] = []
  for (const s of sessions) {
    if (pinnedKeys.has(keyFn(s))) {
      pinned.push(s)
    } else if (s.time.updated >= startMs) {
      today.push(s)
    } else {
      older.push(s)
    }
  }
  pinned.sort(byUpdatedDesc)
  today.sort(byUpdatedDesc)
  older.sort(byUpdatedDesc)
  return { pinned, today, older }
}
