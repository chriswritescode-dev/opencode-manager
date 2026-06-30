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
  const byUpdatedDesc = (a: Session, b: Session) => b.time.updated - a.time.updated

  const pinned: Session[] = []
  const rest: Session[] = []
  for (const s of sessions) {
    if (pinnedKeys.has(keyFn(s))) {
      pinned.push(s)
    } else {
      rest.push(s)
    }
  }
  pinned.sort(byUpdatedDesc)
  const today = rest.filter(s => new Date(s.time.updated) >= startOfDay).sort(byUpdatedDesc)
  const older = rest.filter(s => new Date(s.time.updated) < startOfDay).sort(byUpdatedDesc)
  return { pinned, today, older }
}
