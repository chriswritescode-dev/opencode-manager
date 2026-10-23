import { useSyncExternalStore } from 'react'
import {
  DEFAULT_VOICE_PAUSE_MS,
  VOICE_PAUSE_STORAGE_KEY,
  normalizeVoicePauseMs,
  parseVoicePauseMs,
} from '@opencode-manager/shared/opencode'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

const subscribers = new Set<() => void>()

function readPauseMs(): number {
  const raw = readStoredValue(VOICE_PAUSE_STORAGE_KEY)
  if (raw === null) {
    return DEFAULT_VOICE_PAUSE_MS
  }
  return parseVoicePauseMs(raw) ?? DEFAULT_VOICE_PAUSE_MS
}

function notifySubscribers(): void {
  subscribers.forEach((subscriber) => subscriber())
}

function handleStorageChange(event: StorageEvent): void {
  if (event.key === VOICE_PAUSE_STORAGE_KEY) {
    notifySubscribers()
  }
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber)
  if (subscribers.size === 1) {
    window.addEventListener('storage', handleStorageChange)
  }
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) {
      window.removeEventListener('storage', handleStorageChange)
    }
  }
}

function setPauseMs(ms: number): void {
  const normalized = normalizeVoicePauseMs(ms)
  if (normalized === undefined) {
    return
  }
  writeStoredValue(VOICE_PAUSE_STORAGE_KEY, normalized)
  notifySubscribers()
}

function getServerPauseMs(): number {
  return DEFAULT_VOICE_PAUSE_MS
}

/**
 * Reads and writes the device-local pause-before-sending duration, keeping every
 * mounted consumer in the tab and other tabs in sync. Missing or unusable stored
 * values fall back to {@link DEFAULT_VOICE_PAUSE_MS}.
 */
export function useVoicePauseSetting(): { pauseMs: number; setPauseMs: (ms: number) => void } {
  const pauseMs = useSyncExternalStore(subscribe, readPauseMs, getServerPauseMs)
  return { pauseMs, setPauseMs }
}
