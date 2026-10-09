import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useDebouncedValue } from './useDebouncedValue'

export const AUTOSAVE_DELAY_MS = 800

interface AutosavedSettingHandlers<TStored, TDraft, TCommitted> {
  toDraft: (stored: TStored) => TDraft
  toCommitted: (draft: TDraft, previous: TCommitted | undefined) => TCommitted
  isEqual: (a: TCommitted, b: TCommitted) => boolean
  save: (next: TCommitted, previous: TCommitted | undefined) => void
}

interface UseAutosavedSettingOptions<TStored, TDraft, TCommitted>
  extends AutosavedSettingHandlers<TStored, TDraft, TCommitted> {
  stored: TStored
  delayMs?: number
}

interface UseAutosavedSettingResult<TDraft> {
  draft: TDraft
  setDraft: Dispatch<SetStateAction<TDraft>>
  commit: () => void
}

export function useAutosavedSetting<TStored, TDraft, TCommitted>({
  stored,
  toDraft,
  toCommitted,
  isEqual,
  save,
  delayMs = AUTOSAVE_DELAY_MS,
}: UseAutosavedSettingOptions<TStored, TDraft, TCommitted>): UseAutosavedSettingResult<TDraft> {
  const handlers = useRef<AutosavedSettingHandlers<TStored, TDraft, TCommitted>>({
    toDraft,
    toCommitted,
    isEqual,
    save,
  })

  useEffect(() => {
    handlers.current = { toDraft, toCommitted, isEqual, save }
  })

  const [draft, setDraft] = useState<TDraft>(() => toDraft(stored))
  const committed = useRef<TCommitted>(toCommitted(draft, undefined))

  useEffect(() => {
    const nextDraft = handlers.current.toDraft(stored)
    setDraft(nextDraft)
    committed.current = handlers.current.toCommitted(nextDraft, committed.current)
  }, [stored])

  const commitDraft = useCallback((value: TDraft) => {
    const { toCommitted: normalize, isEqual: equal, save: persist } = handlers.current
    const next = normalize(value, committed.current)
    if (equal(next, committed.current)) return
    const previous = committed.current
    committed.current = next
    persist(next, previous)
  }, [])

  const debouncedDraft = useDebouncedValue(draft, delayMs)

  useEffect(() => {
    commitDraft(debouncedDraft)
  }, [commitDraft, debouncedDraft])

  const commit = useCallback(() => {
    commitDraft(draft)
  }, [commitDraft, draft])

  return { draft, setDraft, commit }
}
