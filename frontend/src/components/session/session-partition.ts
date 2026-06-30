import type { Session } from '@/api/types'

export interface PartitionedSessions {
  pinned: Session[]
  today: Session[]
  older: Session[]
}

export function partitionSessions(
  sessions: Session[],
  pinnedKeys: Set<string>,
  keyFn: (session: { id: string; directory?: string }) => string,
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
