import { describe, it, expect } from 'vitest'
import { computeScrollTopForRow } from './editorScroll'

describe('computeScrollTopForRow', () => {
  it('centres the row in the viewport', () => {
    expect(computeScrollTopForRow({ rowTop: 500, rowHeight: 24, viewportHeight: 200, maxScrollTop: 1000 })).toBe(412)
  })

  it('clamps to zero when the row is near the top', () => {
    expect(computeScrollTopForRow({ rowTop: 8, rowHeight: 24, viewportHeight: 400, maxScrollTop: 1000 })).toBe(0)
  })

  it('clamps to maxScrollTop when the row is near the end', () => {
    expect(computeScrollTopForRow({ rowTop: 980, rowHeight: 24, viewportHeight: 200, maxScrollTop: 800 })).toBe(800)
  })

  it('returns zero when the content is shorter than the viewport', () => {
    expect(computeScrollTopForRow({ rowTop: 48, rowHeight: 24, viewportHeight: 400, maxScrollTop: 0 })).toBe(0)
  })

  it('tolerates an unmeasured viewport', () => {
    expect(computeScrollTopForRow({ rowTop: 100, rowHeight: 0, viewportHeight: 0, maxScrollTop: 0 })).toBe(0)
  })
})
