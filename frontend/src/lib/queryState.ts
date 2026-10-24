export interface CachedListStates {
  showsInitialLoading: boolean
  showsError: boolean
}

/**
 * Derives the two states a list screen renders from a query that may already hold cached data.
 *
 * A restored or offline query runs pending without fetching, so `isLoading` stays false while no
 * data is available yet, and a failed refetch keeps the succeeded data. Keying both states on
 * `data === undefined` keeps cached lists on screen instead of flashing a skeleton or an empty
 * state during a restore.
 *
 * @param data Query data, `undefined` until the first successful load or restore.
 * @param isError Whether the query settled with an error.
 * @param enabled Whether the query is allowed to run, so an intentionally idle query is not a load.
 */
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
