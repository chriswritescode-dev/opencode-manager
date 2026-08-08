import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { CodeEditor } from '@/components/ui/code-editor'
import { EditorFindBar } from '@/components/ui/editor-find-bar'
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog'
import { useMobile } from '@/hooks/useMobile'
import { useFindInText } from '@/lib/useFindInText'
import { parseJsonc, parseJsoncErrorLine, resolveJsoncIssueLine } from '@/lib/jsonc'
import { FetchError } from '@/api/fetchWrapper'
import { OpenCodeConfigSchema } from '@opencode-manager/shared'
import type { OpenCodeConfig } from '@/api/types/settings'

type ValidationIssue = {
  path: string
  message: string
  line: number | null
}

interface OpenCodeConfigEditorProps {
  config: OpenCodeConfig | null
  isOpen: boolean
  onClose: () => void
  onUpdate: (content: string) => Promise<void>
}

export function OpenCodeConfigEditor({
  config,
  isOpen,
  onClose,
  onUpdate,
}: OpenCodeConfigEditorProps) {
  const [editConfigContent, setEditConfigContent] = useState('')
  const [initialContent, setInitialContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDiscardPromptOpen, setIsDiscardPromptOpen] = useState(false)
  const [editError, setEditError] = useState('')
  const [editErrorLine, setEditErrorLine] = useState<number | null>(null)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [removedFields, setRemovedFields] = useState<string[]>([])
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [revealNonce, setRevealNonce] = useState(0)
  const isMobile = useMobile()
  const isDirty = editConfigContent !== initialContent
  const { query, setQuery, matches, currentMatchIndex, hasMatches, next, prev } = useFindInText(editConfigContent)

  const revealLine = useCallback((line: number | null) => {
    setActiveLine(line)
    setRevealNonce((n) => n + 1)
  }, [])

  const resetErrors = () => {
    setEditError('')
    setEditErrorLine(null)
    setValidationIssues([])
    setRemovedFields([])
    setActiveLine(null)
  }

  useEffect(() => {
    if (config && isOpen) {
      const next = config.rawContent || JSON.stringify(config.content, null, 2)
      setEditConfigContent(next)
      setInitialContent(next)
      resetErrors()
      setIsSaving(false)
      setIsDiscardPromptOpen(false)
    }
  }, [config, isOpen])

  const requestClose = () => {
    if (isSaving) return
    if (isDirty) {
      setIsDiscardPromptOpen(true)
      return
    }
    onClose()
  }

  const discardAndClose = () => {
    setIsDiscardPromptOpen(false)
    onClose()
  }

  const getIssueText = (issue: ValidationIssue) => `${issue.path}: ${issue.message}`

  const resolveIssues = (
    issues: Array<{ path: PropertyKey[] | string; message: string }>,
  ): ValidationIssue[] =>
    issues.map((issue) => {
      const path = issue.path
      const isStructured = Array.isArray(path)
      const displaySegments = isStructured
        ? path.map(String)
        : String(path).split('.').filter((segment) => segment.length > 0)
      const displayPath = displaySegments.length > 0 ? displaySegments.join('.') : 'root'
      return {
        path: displayPath,
        message: issue.message,
        line: resolveJsoncIssueLine(editConfigContent, path),
      }
    })

  const updateConfig = async () => {
    if (!config) return

    try {
      resetErrors()
      const parsedConfig = parseJsonc<Record<string, unknown>>(editConfigContent)
      const validationResult = OpenCodeConfigSchema.safeParse(parsedConfig)
      if (!validationResult.success) {
        const issues = resolveIssues(validationResult.error.issues)
        setValidationIssues(issues)
        setEditError(`Configuration validation failed: ${issues.map(getIssueText).join('; ')}`)
        return
      }

      setIsSaving(true)
      await onUpdate(editConfigContent)
      onClose()
    } catch (error) {
      if (error instanceof SyntaxError) {
        const line = parseJsoncErrorLine(error)
        setEditErrorLine(line)
        revealLine(line)
        setEditError(`Invalid JSON/JSONC: ${error.message}`)
      } else if (error instanceof FetchError) {
        const issues = resolveIssues(error.validationIssues ?? [])
        setValidationIssues(issues)
        setRemovedFields(error.removedFields ?? [])
        setEditError(error.detail || error.message)
      } else if (error instanceof Error) {
        setEditError(error.message)
      } else {
        setEditError('Failed to save configuration')
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!config) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) requestClose() }}>
        <DialogContent
          mobileFullscreen
          keyboardAware
          onOpenAutoFocus={(event) => {
            if (isMobile) event.preventDefault()
          }}
          className="flex w-full min-w-0 flex-col gap-0 p-0 sm:max-h-[85vh] sm:max-w-4xl sm:p-6"
        >
          <DialogHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 border-b p-4 sm:p-6">
            <DialogTitle className="text-lg font-semibold sm:text-xl">
              {`Edit Config: ${config.name}`}
            </DialogTitle>
          </DialogHeader>

          <EditorFindBar
            query={query}
            onQueryChange={setQuery}
            matchCount={matches.length}
            currentMatch={hasMatches ? currentMatchIndex + 1 : 0}
            onPrev={prev}
            onNext={next}
            inputName="config-find"
            placeholder="Find in config..."
          />

          <div className="min-h-0 flex-1 overflow-hidden sm:p-4">
            <CodeEditor
              id="edit-config-content"
              ariaLabel="Config content"
              value={editConfigContent}
              onChange={(next) => {
                setEditConfigContent(next)
                resetErrors()
              }}
              highlights={matches}
              activeHighlightIndex={currentMatchIndex}
              activeLine={activeLine}
              revealNonce={revealNonce}
              autoFocus={!isMobile}
              disabled={isSaving}
              className="sm:rounded-md sm:border sm:border-input"
            />
          </div>

          {editError && (
            <div className="max-h-40 shrink-0 space-y-2 overflow-y-auto border-t bg-background p-3">
              <p className="break-words text-xs text-red-500 sm:text-sm">
                {editError}
                {editErrorLine != null && (
                  <button
                    type="button"
                    onClick={() => revealLine(editErrorLine)}
                    className="ml-2 h-10 rounded px-2 text-xs underline underline-offset-2 md:h-8"
                  >
                    Go to line {editErrorLine}
                  </button>
                )}
              </p>
              {validationIssues.length > 0 && (
                <ul className="max-h-28 space-y-1 pl-4 text-xs text-red-500 list-disc sm:text-sm">
                  {validationIssues.map((issue) => (
                    <li key={getIssueText(issue)}>
                      {issue.line != null ? (
                        <button
                          type="button"
                          onClick={() => revealLine(issue.line)}
                          className="min-h-10 w-full text-left underline underline-offset-2 md:min-h-0"
                        >
                          {getIssueText(issue)}{' '}
                          <span className="text-muted-foreground">(line {issue.line})</span>
                        </button>
                      ) : (
                        getIssueText(issue)
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {removedFields.length > 0 && (
                <p className="break-words text-xs text-amber-600 sm:text-sm">
                  Removed invalid fields: {removedFields.join(', ')}
                </p>
              )}
            </div>
          )}

          <DialogFooter data-editor-footer className="shrink-0 gap-2 border-t p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:p-4 sm:pb-4">
            <Button
              variant="outline"
              onClick={requestClose}
              disabled={isSaving}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={updateConfig}
              disabled={isSaving || !editConfigContent.trim()}
              className="flex-1 sm:flex-none"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog
        open={isDiscardPromptOpen}
        onOpenChange={(open) => !open && setIsDiscardPromptOpen(false)}
        onDiscard={discardAndClose}
        onKeepEditing={() => setIsDiscardPromptOpen(false)}
        itemName={config.name}
      />
    </>
  )
}
