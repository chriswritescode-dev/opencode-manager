import { useMemo, type ReactNode } from 'react'
import { common, createLowlight } from 'lowlight'
import { z } from 'zod'
import type { DiffRow } from '@/lib/diffLines'
import { cn } from '@/lib/utils'

const lowlight = createLowlight(common)

type HighlightedNode = ReturnType<typeof lowlight.highlight>['children'][number]

const ROW_CLASS = {
  add: 'bg-diff-add/15',
  remove: 'bg-diff-delete/15',
  context: '',
  gap: '',
} satisfies Record<DiffRow['kind'], string>

const MARKER_CLASS = {
  add: 'text-diff-add',
  remove: 'text-diff-delete',
  context: 'text-muted-foreground',
  gap: 'text-muted-foreground',
} satisfies Record<DiffRow['kind'], string>

const MARKER_TEXT = {
  add: '+',
  remove: '-',
  context: ' ',
  gap: '⋯',
} satisfies Record<DiffRow['kind'], string>

function renderHighlightedNode(node: HighlightedNode, key: number): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null

  const classNames = z
    .union([z.string(), z.array(z.union([z.string(), z.number()]))])
    .safeParse(node.properties?.className)
  const className = classNames.success
    ? Array.isArray(classNames.data)
      ? classNames.data.join(' ')
      : classNames.data
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
