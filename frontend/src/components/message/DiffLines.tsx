import { useMemo, type ReactNode } from 'react'
import { common, createLowlight } from 'lowlight'
import type { DiffRow } from '@/lib/diffLines'
import { cn } from '@/lib/utils'

const lowlight = createLowlight(common)

type HighlightedNode = ReturnType<typeof lowlight.highlight>['children'][number]

const ROW_CLASS: Record<DiffRow['kind'], string> = {
  add: 'bg-diff-add/15',
  remove: 'bg-diff-delete/15',
  context: '',
  gap: '',
}

const MARKER_CLASS: Record<DiffRow['kind'], string> = {
  add: 'text-diff-add',
  remove: 'text-diff-delete',
  context: 'text-muted-foreground',
  gap: 'text-muted-foreground',
}

const MARKER_TEXT: Record<DiffRow['kind'], string> = {
  add: '+',
  remove: '-',
  context: ' ',
  gap: '⋯',
}

function renderHighlightedNode(node: HighlightedNode, key: number): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null

  const rawClassName = node.properties?.className
  const className = Array.isArray(rawClassName)
    ? rawClassName.join(' ')
    : typeof rawClassName === 'string'
      ? rawClassName
      : undefined

  return (
    <span key={key} className={className}>
      {node.children.map((child, index) => renderHighlightedNode(child, index))}
    </span>
  )
}

function highlightLine(text: string, language: string): ReactNode {
  if (!text || !lowlight.registered(language)) return text
  return lowlight
    .highlight(language, text)
    .children.map((node, index) => renderHighlightedNode(node, index))
}

/** Renders unified diff rows as a themed, line-numbered, syntax-highlighted block. */
export function DiffLines({ rows, language }: { rows: DiffRow[]; language: string }) {
  const highlighted = useMemo(
    () => rows.map((row) => (row.kind === 'gap' ? row.text : highlightLine(row.text, language))),
    [rows, language],
  )
  const maxLineNumber = rows.reduce((max, row) => Math.max(max, row.newLine ?? row.oldLine ?? 0), 0)
  const gridTemplateColumns = `${Math.max(String(maxLineNumber).length, 1)}ch 1ch minmax(0, 1fr)`

  return (
    <span className="block font-mono text-xs leading-5">
      {rows.map((row, index) => (
        <span
          key={index}
          className={cn('grid', ROW_CLASS[row.kind])}
          style={{ gridTemplateColumns }}
        >
          <span className="select-none pr-2 text-right text-muted-foreground">
            {row.kind === 'gap' ? '' : row.newLine ?? row.oldLine}
          </span>
          <span className={cn('select-none', MARKER_CLASS[row.kind])}>{MARKER_TEXT[row.kind]}</span>
          <span className="whitespace-pre-wrap break-all">{highlighted[index]}</span>
        </span>
      ))}
    </span>
  )
}
