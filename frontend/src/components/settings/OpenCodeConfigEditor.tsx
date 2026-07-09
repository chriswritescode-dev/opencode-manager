import { useTranslation } from 'react-i18next'
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Search, ChevronUp, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useFindInText } from '@/lib/useFindInText'
import type { OpenCodeConfig } from '@/api/types/settings'
import { parseJsonc } from '@/lib/jsonc'
import { FetchError } from '@/api/fetchWrapper'
import { OpenCodeConfigSchema } from '@opencode-manager/shared'

type ValidationIssue = {
  path: string
  message: string
}

interface OpenCodeConfigEditorProps {
  config: OpenCodeConfig | null
  isOpen: boolean
  onClose: () => void
  onUpdate: (content: string) => Promise<void>
  isUpdating: boolean
}

export function OpenCodeConfigEditor({
  config,
  isOpen,
  onClose,
  onUpdate,
  isUpdating
}: OpenCodeConfigEditorProps) {
  const { t } = useTranslation()
  const [editConfigContent, setEditConfigContent] = useState('')
  const [editError, setEditError] = useState('')
  const [editErrorLine, setEditErrorLine] = useState<number | null>(null)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [removedFields, setRemovedFields] = useState<string[]>([])
  const [isTextareaFocused, setIsTextareaFocused] = useState(false)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { query, setQuery, matches, currentMatchIndex, hasMatches, next, prev } = useFindInText(editConfigContent)

  useEffect(() => {
    if (config && isOpen) {
      setEditConfigContent(config.rawContent || JSON.stringify(config.content, null, 2))
      setEditError('')
      setEditErrorLine(null)
      setValidationIssues([])
      setRemovedFields([])
    }
  }, [config, isOpen])

  useEffect(() => {
    if (isOpen && editTextareaRef.current) {
      editTextareaRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    const textarea = editTextareaRef.current
    if (!textarea || matches.length === 0) return
    const match = matches[currentMatchIndex]
    if (match) {
      const textBefore = editConfigContent.substring(0, match.startIndex)
      const lineNumber = textBefore.split('\n').length
      const lineHeight = textarea.scrollHeight / textarea.value.split('\n').length
      textarea.scrollTop = lineHeight * (lineNumber - 1) - textarea.clientHeight / 2 + lineHeight / 2
      syncBackdropScroll()
    }
  }, [currentMatchIndex, matches, editConfigContent])

  const syncBackdropScroll = () => {
    const textarea = editTextareaRef.current
    const backdrop = backdropRef.current
    if (textarea && backdrop) {
      backdrop.scrollTop = textarea.scrollTop
      backdrop.scrollLeft = textarea.scrollLeft
    }
  }

  const handleFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) prev()
      else next()
    }
  }

  const renderHighlightedContent = (focused: boolean) => {
    if (matches.length === 0 || focused) {
      return editConfigContent
    }
    const segments: React.ReactNode[] = []
    let lastIndex = 0
    matches.forEach((match, index) => {
      if (match.startIndex > lastIndex) {
        segments.push(editConfigContent.substring(lastIndex, match.startIndex))
      }
      const isCurrent = index === currentMatchIndex
      segments.push(
        <mark
          key={index}
          className={isCurrent ? 'bg-orange-400 text-black rounded-sm' : 'bg-yellow-300/60 text-black rounded-sm'}
        >
          {editConfigContent.substring(match.startIndex, match.endIndex)}
        </mark>
      )
      lastIndex = match.endIndex
    })
    if (lastIndex < editConfigContent.length) {
      segments.push(editConfigContent.substring(lastIndex))
    }
    return segments
  }

  const resetErrors = () => {
    setEditError('')
    setEditErrorLine(null)
    setValidationIssues([])
    setRemovedFields([])
  }

  const getIssueText = (issue: ValidationIssue) => {
    return `${issue.path}: ${issue.message}`
  }

  const updateConfig = async () => {
    if (!config) return

    try {
      resetErrors()
      const parsedConfig = parseJsonc<Record<string, unknown>>(editConfigContent)
      const validationResult = OpenCodeConfigSchema.safeParse(parsedConfig)
      if (!validationResult.success) {
        const issues = validationResult.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.map(String).join('.') : 'root',
          message: issue.message,
        }))
        setValidationIssues(issues)
        setEditError(`${t('createConfig.validationFailed') || 'Configuration validation failed'}: ${issues.map(getIssueText).join('; ')}`)
        return
      }

      await onUpdate(editConfigContent)
      onClose()
    } catch (error) {
      if (error instanceof SyntaxError) {
        const lineMatch = error.message.match(/line\s+(\d+)/i)
        const line = lineMatch ? parseInt(lineMatch[1]) : null
        setEditErrorLine(line)
        if (line && editTextareaRef.current) {
          highlightErrorLine(editTextareaRef.current, line)
        }
        setEditError(`${t('common.invalidJson') || 'Invalid JSON/JSONC'}: ${error.message}`)
      } else if (error instanceof FetchError) {
        setValidationIssues(error.validationIssues || [])
        setRemovedFields(error.removedFields || [])
        setEditError(error.detail || error.message)
      } else if (error instanceof Error) {
        setEditError(error.message)
      } else {
        setEditError(t('settings.failedToSaveConfig') || 'Failed to save configuration')
      }
    }
  }

  const highlightErrorLine = (textarea: HTMLTextAreaElement, line: number) => {
    const lines = textarea.value.split('\n')
    if (line > lines.length) return
    
    let charIndex = 0
    for (let i = 0; i < line - 1; i++) {
      charIndex += lines[i].length + 1
    }
    
    textarea.focus()
    textarea.setSelectionRange(charIndex, charIndex + lines[line - 1].length)
    
    // Scroll to make the error line visible
    const lineHeight = textarea.scrollHeight / lines.length
    const targetPosition = lineHeight * (line - 1)
    textarea.scrollTop = targetPosition - textarea.clientHeight / 2 + lineHeight / 2
  }

  if (!config) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent mobileFullscreen className="gap-0 flex flex-col p-0 md:p-6 w-full min-w-0 sm:max-w-4xl max-h-[90vh] sm:max-h-[85vh]">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-lg sm:text-xl font-semibold">
            {`${t('settings.editConfig') || 'Edit Config'}: ${config.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleFindKeyDown}
              placeholder={t('settings.findInConfig')}
              className="pl-9 h-9 text-[16px] sm:text-xs md:text-sm"
              autoComplete="off"
              name="config-find"
            />
          </div>
          {query && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {hasMatches
                ? `${currentMatchIndex + 1} ${t('common.of') || 'of'} ${matches.length}`
                : `0 ${t('matches') || 'matches'}`}
            </span>
          )}
          <button
            onClick={prev}
            disabled={!hasMatches}
            className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('settings.previousMatch')}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={next}
            disabled={!hasMatches}
            className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('settings.nextMatch')}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 p-0 sm:p-4 overflow-hidden relative w-full">
          <div className="relative h-full w-full">
            <div
              ref={backdropRef}
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words font-mono text-[16px] sm:text-xs md:text-sm px-3 py-2 border border-transparent rounded-none sm:rounded-md ${hasMatches && !isTextareaFocused ? 'text-foreground' : 'text-transparent'}`}
            >
              {renderHighlightedContent(isTextareaFocused)}
            </div>
            <Textarea
              id="edit-config-content"
              ref={editTextareaRef}
              value={editConfigContent}
              onChange={(e) => {
                setEditConfigContent(e.target.value)
                resetErrors()
              }}
              onScroll={syncBackdropScroll}
              onFocus={() => setIsTextareaFocused(true)}
              onBlur={() => setIsTextareaFocused(false)}
              spellCheck={false}
              className={`relative bg-transparent font-mono text-[16px] sm:text-xs md:text-sm resize-none h-full w-full rounded-none sm:rounded-md ${hasMatches && !isTextareaFocused ? 'text-transparent caret-foreground' : ''} ${editErrorLine ? 'error-highlight' : ''}`}
            />
          </div>
          {editError && (
            <div className="absolute bottom-0 left-0 right-0 bg-background/95 border-t p-2 sm:p-3 space-y-2">
              <p className="text-xs sm:text-sm text-red-500 break-words">
                {editError}
                {editErrorLine && (
                  <span className="ml-2 text-xs">{t('createConfig.line', { line: editErrorLine }) || `(Line ${editErrorLine})`}</span>
                )}
              </p>
              {validationIssues.length > 0 && (
                <ul className="max-h-28 overflow-auto space-y-1 text-xs sm:text-sm text-red-500 list-disc pl-4">
                  {validationIssues.map((issue) => (
                    <li key={getIssueText(issue)}>{getIssueText(issue)}</li>
                  ))}
                </ul>
              )}
              {removedFields.length > 0 && (
                <p className="text-xs sm:text-sm text-amber-600 break-words">
                  {t('settings.removedInvalidFields') || 'Removed invalid fields:'} {removedFields.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1 sm:flex-none"
          >
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={updateConfig} 
            disabled={isUpdating || !editConfigContent.trim()}
            className="flex-1 sm:flex-none"
          >
            {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('common.update') || 'Update'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
