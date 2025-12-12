import { useState, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { parseJsonc } from '@/lib/jsonc'

interface CreateConfigDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string, content: string, isDefault: boolean) => Promise<void>
  isUpdating: boolean
}

export function CreateConfigDialog({ isOpen, onOpenChange, onCreate, isUpdating }: CreateConfigDialogProps) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState('')
  const [errorLine, setErrorLine] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = async (event?: React.MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    
    if (!name.trim() || !content.trim()) return

    try {
      await onCreate(name.trim(), content.trim(), isDefault)
      setName('')
      setContent('')
      setIsDefault(false)
      setError('')
      setErrorLine(null)
    } catch (error) {
      if (error instanceof SyntaxError) {
        const match = error.message.match(/line (\d+)/i)
        const line = match ? parseInt(match[1]) : null
        setErrorLine(line)
        setError(`JSON Error: ${error.message}`)
        if (line && textareaRef.current) {
          highlightErrorLine(textareaRef.current, line)
        }
      } else if (error instanceof Error) {
        setError(error.message)
        setErrorLine(null)
      } else {
        setError('Failed to create configuration')
        setErrorLine(null)
      }
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const fileContent = e.target?.result as string
      try {
        parseJsonc(fileContent)
        setContent(fileContent)
        setName(file.name.replace('.json', '').replace('.jsonc', ''))
        setError('')
        setErrorLine(null)
      } catch (err) {
        if (err instanceof SyntaxError) {
          const match = err.message.match(/line (\d+)/i)
          const line = match ? parseInt(match[1]) : null
          setErrorLine(line)
          setError(`Invalid JSON/JSONC file: ${err.message}`)
        } else {
          setError('Invalid JSON/JSONC file')
          setErrorLine(null)
        }
      }
    }
    reader.readAsText(file)
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
  }

  const handleContentChange = (value: string) => {
    setContent(value)
    setError('')
    setErrorLine(null)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Create OpenCode Config</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-2">
          <div>
            <Label htmlFor="config-name" className="pb-1">Config Name</Label>
            <Input
              id="config-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-config"
            />
          </div>
          
          <div>
            <Label htmlFor="config-upload" className="pb-1">Upload JSON File</Label>
            <Input
              id="config-upload"
              type="file"
              accept=".json,.jsonc"
              onChange={handleFileUpload}
            />
          </div>

          <div>
            <Label htmlFor="config-content" className="pb-1">Config Content (JSON/JSONC)</Label>
            <Textarea
              id="config-content"
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder='{"$schema": "https://opencode.ai/config.json", "theme": "dark"}'
              rows={12}
              className="font-mono text-sm"
            />
            {error && (
              <p className="text-sm text-red-500 mt-2">
                {error}
                {errorLine && (
                  <span className="ml-2 text-xs">(Line {errorLine})</span>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="config-default"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
            <Label htmlFor="config-default">Set as default configuration</Label>
          </div>
        </div>

        <div className="flex justify-end gap-2 flex-shrink-0 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            type="button"
            onClick={(e) => handleSubmit(e)} 
            disabled={isUpdating || !name.trim() || !content.trim()}
          >
            {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}