export interface CachedListStates {
  showsInitialLoading: boolean
  showsError: boolean
}

export function cachedListStates<T>(
  data: T | undefined,
  isError: boolean,
  enabled = true,
): CachedListStates {
  return {
    showsInitialLoading: enabled && data === undefined && !isError,
    showsError: isError && data === undefined,
  }
}
