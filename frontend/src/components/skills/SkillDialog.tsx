import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Upload, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Skill } from '@/api/skills'

interface SkillDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: { name: string; description: string; content: string } | FormData) => Promise<void>
  skill?: Skill | null
  isUpdating: boolean
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-')
}

function parseSkillContent(content: string): { name?: string; description?: string; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  
  if (!frontmatterMatch) {
    return { body: content }
  }
  
  const frontmatter = frontmatterMatch[1]
  const body = content.slice(frontmatterMatch[0].length).trim()
  
  const nameMatch = frontmatter.match(/name:\s*(.+)/)
  const descriptionMatch = frontmatter.match(/description:\s*(.+)/)
  
  return {
    name: nameMatch?.[1]?.trim(),
    description: descriptionMatch?.[1]?.trim(),
    body,
  }
}

export function SkillDialog({ isOpen, onOpenChange, onSave, skill, isUpdating }: SkillDialogProps) {
  const [mode, setMode] = useState<'manual' | 'upload'>('manual')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const isEdit = !!skill
  
  useEffect(() => {
    if (isOpen) {
      if (skill) {
        setName(skill.name)
        setDescription(skill.description)
        setContent(skill.content)
      } else {
        setName('')
        setDescription('')
        setContent('')
      }
      setError('')
      setMode('manual')
      setFileName('')
    }
  }, [isOpen, skill])
  
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (e) => {
      const fileContent = e.target?.result as string
      const parsed = parseSkillContent(fileContent)
      
      if (parsed.name) {
        setName(parsed.name)
      } else {
        const baseName = file.name.replace(/\.(md|mdc)$/i, '')
        setName(slugify(baseName))
      }
      
      if (parsed.description) {
        setDescription(parsed.description)
      }
      
      setContent(parsed.body || fileContent)
      setFileName(file.name)
      setError('')
    }
    
    reader.onerror = () => {
      setError('Failed to read file')
    }
    
    reader.readAsText(file)
  }, [])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      setError('Skill name is required')
      return
    }
    
    if (!description.trim()) {
      setError('Skill description is required')
      return
    }
    
    if (!content.trim()) {
      setError('Skill content is required')
      return
    }
    
    try {
      await onSave({
        name: slugify(name),
        description: description.trim(),
        content: content.trim(),
      })
      
      if (!skill) {
        setName('')
        setDescription('')
        setContent('')
      }
      setError('')
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to save skill')
      }
    }
  }
  
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!fileName) {
      setError('Please upload a file')
      return
    }
    
    if (!name.trim()) {
      setError('Skill name is required')
      return
    }
    
    if (!description.trim()) {
      setError('Skill description is required')
      return
    }
    
    try {
      const formData = new FormData()
      formData.append('name', slugify(name))
      formData.append('description', description.trim())
      
      const frontmatter = `---
name: ${slugify(name)}
description: ${description.trim()}
---
${content.trim()}`
      const blob = new Blob([frontmatter], { type: 'text/markdown' })
      formData.append('file', blob, 'SKILL.md')
      
      await onSave(formData)
      
      setName('')
      setDescription('')
      setContent('')
      setFileName('')
      setError('')
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to save skill')
      }
    }
  }
  
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Skill' : 'Add Skill'}
          </DialogTitle>
        </DialogHeader>
        
        {!isEdit && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'manual' | 'upload')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Manual
              </TabsTrigger>
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload File
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="manual">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-custom-skill"
                    disabled={isUpdating}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, numbers, and hyphens only
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this skill does"
                    disabled={isUpdating}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="content">Content</Label>
                  <Textarea
                    ref={textareaRef}
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Instructions for the AI assistant..."
                    className="min-h-[200px] font-mono text-sm"
                    disabled={isUpdating}
                  />
                </div>
                
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isUpdating}>
                    {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {isEdit ? 'Save Changes' : 'Create Skill'}
                  </Button>
                </div>
              </form>
            </TabsContent>
            
            <TabsContent value="upload">
              <form onSubmit={handleUploadSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Upload Markdown File</Label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".md,.mdc"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUpdating}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {fileName || 'Select File'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Upload a .md or .mdc file. The name and description can be edited after upload.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="upload-name">Name</Label>
                  <Input
                    id="upload-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-custom-skill"
                    disabled={isUpdating}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="upload-description">Description</Label>
                  <Input
                    id="upload-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this skill does"
                    disabled={isUpdating}
                  />
                </div>
                
                {content && (
                  <div className="space-y-2">
                    <Label>Preview</Label>
                    <pre className="p-3 bg-muted rounded-md text-xs max-h-[150px] overflow-y-auto whitespace-pre-wrap">
                      {content.slice(0, 500)}{content.length > 500 ? '...' : ''}
                    </pre>
                  </div>
                )}
                
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isUpdating}>
                    {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create Skill
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        )}
        
        {isEdit && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-custom-skill"
                disabled={isUpdating}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this skill does"
                disabled={isUpdating}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-content">Content</Label>
              <Textarea
                ref={textareaRef}
                id="edit-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Instructions for the AI assistant..."
                className="min-h-[200px] font-mono text-sm"
                disabled={isUpdating}
              />
            </div>
            
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
