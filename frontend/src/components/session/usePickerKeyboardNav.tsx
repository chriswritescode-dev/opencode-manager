/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

const PAGE_STEP = 10

export interface PickerRow {
  key: string
}

export function optionId(baseId: string, index: number): string {
  return `${baseId}-option-${index}`
}

export interface PickerCursorState<Row extends PickerRow> {
  rowIndexByKey: Map<string, number>
  cursorIndex: number
  cursorRow: Row | undefined
  registerRef: (key: string, node: HTMLDivElement | null) => void
  moveCursor: (index: number) => void
  resetCursor: () => void
}

export function usePickerCursor<Row extends PickerRow>(
  rows: Row[],
  defaultCursorKey: string | null,
): PickerCursorState<Row> {
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const [cursorKey, setCursorKey] = useState<string | null>(null)

  const rowIndexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.key, index])),
    [rows],
  )

  const cursorIndex = useMemo(() => {
    if (cursorKey) {
      const index = rowIndexByKey.get(cursorKey)
      if (index !== undefined) return index
    }
    return defaultCursorKey ? rowIndexByKey.get(defaultCursorKey) ?? -1 : -1
  }, [cursorKey, rowIndexByKey, defaultCursorKey])

  const cursorRow = cursorIndex >= 0 ? rows[cursorIndex] : undefined

  const registerRef = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) rowRefs.current.set(key, node)
    else rowRefs.current.delete(key)
  }, [])

  useEffect(() => {
    if (!cursorRow) return
    const node = rowRefs.current.get(cursorRow.key)
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [cursorRow])

  const moveCursor = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return
      setCursorKey(row.key)
    },
    [rows],
  )

  const resetCursor = useCallback(() => {
    setCursorKey(null)
  }, [])

  return {
    rowIndexByKey,
    cursorIndex,
    cursorRow,
    registerRef,
    moveCursor,
    resetCursor,
  }
}

export interface PickerKeyNavOptions<Row extends PickerRow> {
  rows: Row[]
  cursorIndex: number
  cursorRow: Row | undefined
  moveCursor: (index: number) => void
  onOpenRow: (row: Row) => void
  onDeleteRow?: (row: Row) => void
  onToggleAllProjects?: () => void
}

export function usePickerKeyNav<Row extends PickerRow>({
  rows,
  cursorIndex,
  cursorRow,
  moveCursor,
  onOpenRow,
  onDeleteRow,
  onToggleAllProjects,
}: PickerKeyNavOptions<Row>): (event: React.KeyboardEvent<HTMLInputElement>) => void {
  return useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return
      if (event.metaKey || event.altKey) return

      const moveBy = (delta: number, wrap: boolean) => {
        if (rows.length === 0) return
        const base = cursorIndex < 0 ? (delta > 0 ? -1 : 0) : cursorIndex
        const raw = base + delta
        const next = wrap
          ? ((raw % rows.length) + rows.length) % rows.length
          : Math.max(0, Math.min(rows.length - 1, raw))
        moveCursor(next)
      }

      const key = event.key
      const ctrlKey = event.key.toLowerCase()

      if (key === 'ArrowDown' || (event.ctrlKey && ctrlKey === 'n')) {
        event.preventDefault()
        moveBy(1, true)
        return
      }
      if (key === 'ArrowUp' || (event.ctrlKey && ctrlKey === 'p')) {
        event.preventDefault()
        moveBy(-1, true)
        return
      }
      if (key === 'PageDown') {
        event.preventDefault()
        moveBy(PAGE_STEP, false)
        return
      }
      if (key === 'PageUp') {
        event.preventDefault()
        moveBy(-PAGE_STEP, false)
        return
      }
      if (key === 'Enter') {
        if (!cursorRow) return
        event.preventDefault()
        onOpenRow(cursorRow)
        return
      }
      if (onToggleAllProjects && event.ctrlKey && ctrlKey === 'a') {
        event.preventDefault()
        onToggleAllProjects()
        return
      }
      if (onDeleteRow && event.ctrlKey && ctrlKey === 'd') {
        if (!cursorRow) return
        event.preventDefault()
        onDeleteRow(cursorRow)
      }
    },
    [rows, cursorIndex, cursorRow, moveCursor, onOpenRow, onDeleteRow, onToggleAllProjects],
  )
}

export interface PickerSearchBarProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  listId: string
  open: boolean
  activeDescendantId: string | undefined
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  name: string
  trailing?: React.ReactNode
}

export function PickerSearchBar({
  inputRef,
  listId,
  open,
  activeDescendantId,
  value,
  onChange,
  onKeyDown,
  placeholder,
  name,
  trailing,
}: PickerSearchBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 sm:px-0">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendantId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-9 pl-9"
          autoComplete="off"
          name={name}
        />
      </div>
      {trailing}
    </div>
  )
}
