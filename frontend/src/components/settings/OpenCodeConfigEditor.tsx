import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import type { OpenCodeConfig } from '@/api/types/settings'
import { parseJsonc } from '@/lib/jsonc'

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
  const [editConfigContent, setEditConfigContent] = useState('')
  const [editError, setEditError] = useState('')
  const [editErrorLine, setEditErrorLine] = useState<number | null>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (config && isOpen) {
      setEditConfigContent(config.rawContent || JSON.stringify(config.content, null, 2))
      setEditError('')
      setEditErrorLine(null)
    }
  }, [config, isOpen])

  useEffect(() => {
    if (isOpen && editTextareaRef.current) {
      editTextareaRef.current.focus()
    }
  }, [isOpen])

  const updateConfig = async () => {
    if (!config) return

    try {
      const parsedContent = parseJsonc<Record<string, unknown>>(editConfigContent)
      
      const forbiddenFields = ['id', 'createdAt', 'updatedAt']
      const foundForbidden = forbiddenFields.filter(field => field in parsedContent)
      if (foundForbidden.length > 0) {
        throw new Error(`Invalid fields found: ${foundForbidden.join(', ')}. These fields are managed automatically.`)
      }
      
      await onUpdate(editConfigContent)
      onClose()
    } catch (error) {
      if (error instanceof SyntaxError) {
        const match = error.message.match(/line (\d+)/i)
        const line = match ? parseInt(match[1]) : null
        setEditErrorLine(line)
        setEditError('Invalid JSON/JSONC format')
      } else {
        setEditError('Failed to save. Please check your changes and try again.')
      }
    }
  }

  if (!config) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent mobileFullscreen className="gap-0 flex flex-col p-0 md:p-6 w-full min-w-0 sm:max-w-4xl max-h-[90vh] sm:max-h-[85vh] z-[200]" overlayClassName="z-[200]">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-lg sm:text-xl font-semibold">
            {`Edit Config: ${config.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 p-0 sm:p-4 overflow-hidden relative w-full">
          <Textarea
            id="edit-config-content"
            ref={editTextareaRef}
            value={editConfigContent}
            onChange={(e) => {
              setEditConfigContent(e.target.value)
              setEditError('')
              setEditErrorLine(null)
            }}
            className="flex-1 font-mono text-[16px] sm:text-xs md:text-sm resize-none h-full rounded-none sm:rounded-md"
          />
          {editError && (
            <div className="absolute bottom-0 left-0 right-0 bg-background/95 border-t p-2 sm:p-3">
              <p className="text-xs sm:text-sm text-red-500">
                {editError}
                {editErrorLine && (
                  <span className="ml-2 text-xs">(Line {editErrorLine})</span>
                )}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button 
            onClick={updateConfig} 
            disabled={isUpdating || !editConfigContent.trim()}
            className="flex-1 sm:flex-none"
          >
            {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
