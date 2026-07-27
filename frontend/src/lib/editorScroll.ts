export interface RowScrollInput {
  rowTop: number
  rowHeight: number
  viewportHeight: number
  maxScrollTop: number
}

export function computeScrollTopForRow({ rowTop, rowHeight, viewportHeight, maxScrollTop }: RowScrollInput): number {
  const centred = rowTop - viewportHeight / 2 + rowHeight / 2
  const upperBound = Math.max(0, maxScrollTop)
  return Math.min(Math.max(0, centred), upperBound)
}
