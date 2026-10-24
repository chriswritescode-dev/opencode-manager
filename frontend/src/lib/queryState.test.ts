import { describe, expect, it } from 'vitest'
import { cachedListStates } from './queryState'

describe('cachedListStates', () => {
  it('shows the skeleton only while there is no data and no error', () => {
    expect(cachedListStates(undefined, false)).toEqual({
      showsInitialLoading: true,
      showsError: false,
    })
  })

  it('shows the error only when the query failed without cached data', () => {
    expect(cachedListStates(undefined, true)).toEqual({
      showsInitialLoading: false,
      showsError: true,
    })
  })

  it('keeps cached data on screen after a failed refetch', () => {
    expect(cachedListStates([], true)).toEqual({
      showsInitialLoading: false,
      showsError: false,
    })
    expect(cachedListStates([{ id: 1 }], true)).toEqual({
      showsInitialLoading: false,
      showsError: false,
    })
  })

  it('keeps loaded data on screen while a refetch runs', () => {
    expect(cachedListStates([], false)).toEqual({
      showsInitialLoading: false,
      showsError: false,
    })
  })

  it('does not report a load for a query that is not allowed to run', () => {
    expect(cachedListStates(undefined, false, false)).toEqual({
      showsInitialLoading: false,
      showsError: false,
    })
  })
})
