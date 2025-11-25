import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Copy, X, Edit3, Save, X as XIcon } from 'lucide-react'
import type { FileInfo } from '@/types/files'
import { API_BASE_URL } from '@/constants/api'

const API_BASE = API_BASE_URL

interface FilePreviewProps {
  file: FileInfo
  hideHeader?: boolean
  isMobileModal?: boolean
  onCloseModal?: () => void
}

export function FilePreview({ file, hideHeader = false, isMobileModal = false, onCloseModal }: FilePreviewProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString()
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = `${API_BASE}/api/files/${file.path}?download=true`
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const decodeBase64 = (base64: string): string => {
    try {
      const binaryString = atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return new TextDecoder('utf-8').decode(bytes)
    } catch {
      throw new Error('Failed to decode base64 content')
    }
  }

  const handleCopyContent = async () => {
    if (file.content) {
      try {
        const content = decodeBase64(file.content)
        await navigator.clipboard.writeText(content)
      } catch (error) {
        console.error('Failed to copy content:', error)
      }
    }
  }

  const handleEdit = () => {
    if (file.content) {
      try {
        const content = decodeBase64(file.content)
        setEditContent(content)
        setViewMode('edit')
        const event = new CustomEvent('editModeChange', { detail: { isEditing: true } })
        window.dispatchEvent(event)
      } catch (err) {
        console.error('Failed to load content for editing:', err)
      }
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`${API_BASE}/api/files/${file.path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', content: editContent }),
      })
      
      if (!response.ok) {
        throw new Error(`Save failed: ${response.statusText}`)
      }
      
      setViewMode('preview')
      const editEvent = new CustomEvent('editModeChange', { detail: { isEditing: false } })
      window.dispatchEvent(editEvent)
      const event = new CustomEvent('fileSaved', { detail: { path: file.path, content: editContent } })
      window.dispatchEvent(event)
    } catch (err) {
      console.error('Failed to save file:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditContent('')
    setViewMode('preview')
    const event = new CustomEvent('editModeChange', { detail: { isEditing: false } })
    window.dispatchEvent(event)
  }

  const isTextFile = file.mimeType?.startsWith('text/') || 
    ['application/json', 'application/xml', 'text/javascript', 'text/typescript'].includes(file.mimeType || '')

  const renderContent = () => {
    if (!file.content) return null

    if (file.mimeType?.startsWith('image/')) {
      return (
        <div className="flex justify-center p-4">
          <img 
            src={`${API_BASE}/api/files/${file.path}?raw=true`}
            alt={file.name}
            className="max-w-full h-auto object-contain rounded"
          />
        </div>
      )
    }

    if (isTextFile) {
      if (viewMode === 'edit') {
        return (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="text-[16px] bg-muted text-foreground p-2 rounded whitespace-pre-wrap font-mono break-words w-full resize-none focus:outline-none focus:ring-0 border-none block"
            style={{ minHeight: '95vh' }}
            placeholder="Edit file content..."
            autoFocus
            data-file-editor="true"
          />
        )
      }
      
      try {
        const textContent = decodeBase64(file.content)
        return (
          <pre className="pb-[200px] text-sm bg-muted text-foreground rounded whitespace-pre-wrap font-mono break-words overflow-x-hidden">
            <code>{textContent}</code>
          </pre>
        )
      } catch {
        return (
          <div className="text-center text-muted-foreground py-8">
            Cannot preview this file - content may be corrupted
          </div>
        )
      }
    }

    return (
      <div className="text-center text-muted-foreground py-8">
        Binary file - download to view content
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {!hideHeader && (
        <>
          <div className={`flex items-start gap-2 px-3 py-2 border-b border-border flex-shrink-0 overflow-hidden ${isMobileModal ? 'pt-3' : ''}`}>
            <div className="flex-1 min-w-0 overflow-hidden">
              <h3 className="text-foreground text-sm font-medium break-all leading-tight">
                {file.name}
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                <span className="bg-muted px-1.5 py-0.5 rounded text-xs truncate max-w-[80px] flex-shrink-0">{file.mimeType || 'Unknown'}</span>
                <span className="truncate flex-shrink-0">{formatFileSize(file.size)}</span>
                <span className="hidden sm:inline truncate flex-shrink-0">{formatDate(file.lastModified)}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-1 flex-shrink-0 mt-1">
              {isMobileModal && onCloseModal && (
                <Button variant="outline" size="sm" onClick={onCloseModal} className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 h-7 w-7 p-0">
                  <X className="w-3 h-3" />
                </Button>
              )}
              
              {isTextFile && viewMode !== 'edit' && (
                <Button variant="outline" size="sm" onClick={handleEdit} className="h-7 w-7 p-0">
                  <Edit3 className="w-3 h-3" />
                </Button>
              )}
              
              {viewMode === 'edit' && (
                <>
                  <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving} className="border-green-600 bg-green-600/10 text-green-600 hover:bg-green-600/20 h-7 w-7 p-0">
                    <Save className="w-3 h-3" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCancel} className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 h-7 w-7 p-0">
                    <XIcon className="w-3 h-3" />
                  </Button>
                </>
              )}
              
{isTextFile && viewMode !== 'edit' && (
                 <Button variant="outline" size="sm" onClick={handleCopyContent} className="h-7 w-7 p-0">
                   <Copy className="w-3 h-3" />
                 </Button>
               )}
               
               {viewMode !== 'edit' && (
                 <Button variant="outline" size="sm" onClick={handleDownload} className="h-7 w-7 p-0">
                   <Download className="w-3 h-3" />
                 </Button>
               )}
            </div>
          </div>
        </>
      )}
      
      <div className={`flex-1 ${viewMode === 'edit' ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain'} min-h-0 overflow-x-hidden`}>
        <div className="p-2 min-w-0">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
