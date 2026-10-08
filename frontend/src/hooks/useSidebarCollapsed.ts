import { usePersistentBoolean } from './usePersistentBoolean'

const STORAGE_KEY = 'oc:sidebar:collapsed'

export function useSidebarCollapsed(): [boolean, () => void] {
  return usePersistentBoolean(STORAGE_KEY, false)
}
