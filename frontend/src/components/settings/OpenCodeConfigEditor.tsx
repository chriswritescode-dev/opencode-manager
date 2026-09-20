import { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Download, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CodeEditor } from '@/components/ui/code-editor'
import { EditorFindBar } from '@/components/ui/editor-find-bar'
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog'
import { OpenCodeConfigSourcesNotice } from './OpenCodeConfigSourcesNotice'
import { useMobile } from '@/hooks/useMobile'
import { useFindInText } from '@/lib/useFindInText'
import { parseJsonc, parseJsoncErrorLine, resolveJsoncIssueLine } from '@/lib/jsonc'
import { FetchError } from '@/api/fetchWrapper'
import { OpenCodeConfigSchema } from '@opencode-manager/shared'
import {
  downloadOpenCodeConfigSource,
  getOpenCodeConfigSources,
  getPreferredOpenCodeConfigSource,
  isOpenCodeConfigSourceName,
} from '@/api/types/settings'
import type { OpenCodeConfigFile, OpenCodeConfigSource, OpenCodeConfigSourceName } from '@/api/types/settings'

type ValidationIssue = {
  path: string
  message: string
  line: number | null
}

interface OpenCodeConfigEditorProps {
  config: OpenCodeConfigFile | null
  isOpen: boolean
  onClose: () => void
  onUpdate: (request: { content: string; source: OpenCodeConfigSourceName; expectedRevision?: string }) => Promise<void>
}

export function OpenCodeConfigEditor({
  config,
  isOpen,
  onClose,
  onUpdate,
}: OpenCodeConfigEditorProps) {
  const [draftSource, setDraftSource] = useState<OpenCodeConfigSource | null>(null)
  const [draftRevision, setDraftRevision] = useState<string | undefined>(undefined)
  const [editConfigContent, setEditConfigContent] = useState('')
  const [initialContent, setInitialContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDiscardPromptOpen, setIsDiscardPromptOpen] = useState(false)
  const [editError, setEditError] = useState('')
  const [editErrorLine, setEditErrorLine] = useState<number | null>(null)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [revealNonce, setRevealNonce] = useState(0)
  const hasInitializedSessionRef = useRef(false)
  const isMobile = useMobile()
  const sourceSelectId = useId()
  const sources = useMemo(() => (config ? getOpenCodeConfigSources(config) : []), [config])
  const isDirty = editConfigContent !== initialContent
  const { query, setQuery, matches, currentMatchIndex, hasMatches, next, prev } = useFindInText(editConfigContent)

  const revealLine = useCallback((line: number | null) => {
    setActiveLine(line)
    setRevealNonce((n) => n + 1)
  }, [])

  const resetErrors = useCallback(() => {
    setEditError('')
    setEditErrorLine(null)
    setValidationIssues([])
    setActiveLine(null)
  }, [])

  const selectSource = useCallback((name: OpenCodeConfigSourceName) => {
    const next = sources.find((source) => source.name === name)
    if (!next) return
    setDraftSource(next)
    setDraftRevision(config?.revision)
    setEditConfigContent(next.rawContent)
    setInitialContent(next.rawContent)
    resetErrors()
  }, [sources, config?.revision, resetErrors])

  useEffect(() => {
    if (!isOpen) {
      hasInitializedSessionRef.current = false
      return
    }
    if (hasInitializedSessionRef.current || !config) return
    hasInitializedSessionRef.current = true
    const initialSource = getPreferredOpenCodeConfigSource(config)
    const nextContent = initialSource?.rawContent ?? ''
    setDraftSource(initialSource)
    setDraftRevision(config.revision)
    setEditConfigContent(nextContent)
    setInitialContent(nextContent)
    resetErrors()
    setIsSaving(false)
    setIsDiscardPromptOpen(false)
  }, [config, isOpen, resetErrors])

  const handleSourceChange = (name: string) => {
    if (isDirty || isSaving) return
    if (!isOpenCodeConfigSourceName(name)) return
    selectSource(name)
  }

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
    if (!config || !draftSource) return

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
      await onUpdate({ content: editConfigContent, source: draftSource.name, expectedRevision: draftRevision })
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
        if (error.statusCode === 409) {
          setEditError(error.detail || 'This configuration changed since you opened it. Reload the file, then reapply your edits.')
        } else {
          setEditError(error.detail || error.message)
        }
      } else if (error instanceof Error) {
        setEditError(error.message)
      } else {
        setEditError('Failed to save configuration')
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!config || !draftSource) return null

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
              Edit {draftSource.name}
            </DialogTitle>
          </DialogHeader>

          <details
            open
            className="group/file-details max-h-[45dvh] shrink-0 overflow-y-auto border-b"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-medium">File details</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/file-details:rotate-180" />
            </summary>
            <div className="space-y-2 px-4 pb-3 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                {sources.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <Label htmlFor={sourceSelectId} className="shrink-0">Source file</Label>
                    <Select
                      value={draftSource.name}
                      onValueChange={handleSourceChange}
                      disabled={isDirty || isSaving}
                    >
                      <SelectTrigger id={sourceSelectId} className="w-full sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.name} value={source.name}>{source.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p className="text-sm font-medium">{draftSource.name}</p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadOpenCodeConfigSource(draftSource)}
                  disabled={isSaving}
                  className="shrink-0"
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download
                </Button>
              </div>
              <p className="break-all text-xs text-muted-foreground">{draftSource.path}</p>
              <p className="text-xs text-muted-foreground">
                Editing this file directly. Other source files and inherited values stay as they are; removing a value deletes its override so an inherited value can reappear.
              </p>
              <OpenCodeConfigSourcesNotice config={config} targetName={draftSource.name} />
            </div>
          </details>

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
        itemName={draftSource.name}
      />
    </>
  )
}
