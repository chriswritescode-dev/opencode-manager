import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
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
        setEditError(error instanceof Error ? error.message : 'Failed to update config')
      }
    }
  }

  if (!isOpen || !config) return null

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-6xl h-[90vh] bg-background border rounded-lg shadow-lg">
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-semibold">Edit Config: {config.name}</h2>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={updateConfig} 
                  disabled={isUpdating || !editConfigContent.trim()}
                >
                  {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Update
                </Button>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-hidden">
              <div className="h-full flex flex-col">
                <Label htmlFor="edit-config-content" className="mb-2">
                  Config Content (JSON/JSONC)
                </Label>
                <Textarea
                  id="edit-config-content"
                  ref={editTextareaRef}
                  value={editConfigContent}
                  onChange={(e) => {
                    setEditConfigContent(e.target.value)
                    setEditError('')
                    setEditErrorLine(null)
                  }}
                  className="flex-1 font-mono text-sm resize-none"
                />
                {editError && (
                  <p className="text-sm text-red-500 mt-2">
                    {editError}
                    {editErrorLine && (
                      <span className="ml-2 text-xs">(Line {editErrorLine})</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}