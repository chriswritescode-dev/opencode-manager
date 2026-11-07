import { useRef } from 'react'
import type { ReactNode } from 'react'
import { DiffLines } from '@/components/file-browser/DiffLines'
import { MarkdownRenderer } from '@/components/file-browser/MarkdownRenderer'
import { WalkthroughOutputDataSchema } from '@opencode-manager/shared/schemas'
import type { ChangeHunk } from '@opencode-manager/shared/schemas'
import type { BuiltinOutputRendererProps } from '../OutputRendererHost'

const HUNK_STATUS_LABELS: Record<ChangeHunk['status'], string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
}

const MARKDOWN_CLASS_NAME = 'p-0!'

function HunkView({
  hunk,
  onOpenFile,
}: {
  hunk: ChangeHunk
  onOpenFile?: (path: string, line?: number) => void
}): ReactNode {
  const compact = hunk.text.length === 0
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/20">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => onOpenFile?.(hunk.file)}
          className="max-w-full truncate font-mono text-xs text-foreground hover:underline"
        >
          {hunk.file}
        </button>
        {compact ? (
          <span className="text-muted-foreground">
            (+{hunk.additions ?? 0}/−{hunk.deletions ?? 0})
          </span>
        ) : (
          <>
            <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
              {HUNK_STATUS_LABELS[hunk.status]}
            </span>
            <span className="break-all font-mono text-muted-foreground">{hunk.header}</span>
          </>
        )}
      </div>
      {!compact && (
        <div className="overflow-x-auto">
          <DiffLines
            diff={hunk.text}
            onLineClick={(line) => onOpenFile?.(hunk.file, line)}
          />
        </div>
      )}
    </div>
  )
}

/** Built-in renderer for walkthrough outputs: ordered stops, each explaining its hunks. */
export function WalkthroughOutputRenderer({
  data,
  onOpenFile,
}: BuiltinOutputRendererProps): ReactNode {
  const stopRefs = useRef<Array<HTMLElement | null>>([])
  const parsed = WalkthroughOutputDataSchema.safeParse(data)

  if (!parsed.success) {
    return <p className="text-sm text-muted-foreground">This output's data is invalid</p>
  }

  const walkthrough = parsed.data

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">{walkthrough.title}</h2>
        <MarkdownRenderer content={walkthrough.summary} className={MARKDOWN_CLASS_NAME} />
      </header>

      {walkthrough.stops.length > 0 && (
        <nav aria-label="Walkthrough stops" className="flex flex-wrap gap-2">
          {walkthrough.stops.map((stop, index) => (
            <button
              key={stop.id}
              type="button"
              onClick={() => stopRefs.current[index]?.scrollIntoView({ block: 'start' })}
              className="rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              {index + 1}. {stop.title}
            </button>
          ))}
        </nav>
      )}

      {walkthrough.stops.map((stop, index) => (
        <section
          key={stop.id}
          ref={(element) => {
            stopRefs.current[index] = element
          }}
          className="scroll-mt-4 space-y-3"
        >
          <h3 className="text-base font-semibold text-foreground">
            {index + 1}. {stop.title}
          </h3>
          <MarkdownRenderer content={stop.explanation} className={MARKDOWN_CLASS_NAME} />
          {stop.hunks.length > 0 && (
            <div className="space-y-3">
              {stop.hunks.map((hunk) => (
                <HunkView key={hunk.id} hunk={hunk} onOpenFile={onOpenFile} />
              ))}
            </div>
          )}
        </section>
      ))}

      {walkthrough.risks && walkthrough.risks.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Risks</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {walkthrough.risks.map((risk, index) => (
              <li key={index}>{risk}</li>
            ))}
          </ul>
        </section>
      )}

      {walkthrough.testing && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">Testing</h3>
          <MarkdownRenderer content={walkthrough.testing} className={MARKDOWN_CLASS_NAME} />
        </section>
      )}

      {walkthrough.otherHunks.length > 0 && (
        <details className="overflow-hidden rounded-md border border-border bg-muted/20">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
            Other changes ({walkthrough.otherHunks.length})
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            {walkthrough.otherHunks.map((hunk) => (
              <HunkView key={hunk.id} hunk={hunk} onOpenFile={onOpenFile} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
