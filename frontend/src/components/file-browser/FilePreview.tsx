import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { Button } from '@/components/ui/button'
import { Download, X, Edit3, Save, X as XIcon, WrapText } from 'lucide-react'
import type { FileInfo } from '@/types/files'
import { API_BASE_URL } from '@/config'
import { VirtualizedTextView, type VirtualizedTextViewHandle } from '@/components/ui/virtualized-text-view'


const API_BASE = API_BASE_URL

const VIRTUALIZATION_THRESHOLD_BYTES = 8_000

interface FilePreviewProps {
  file: FileInfo
  hideHeader?: boolean
  isMobileModal?: boolean
  onCloseModal?: () => void
  onFileSaved?: () => void
  initialLineNumber?: number
}

export const FilePreview = memo(function FilePreview({ file, hideHeader = false, isMobileModal = false, onCloseModal, onFileSaved, initialLineNumber }: FilePreviewProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [hasVirtualizedChanges, setHasVirtualizedChanges] = useState(false)
  const [highlightedLine, setHighlightedLine] = useState<number | undefined>(initialLineNumber)
  const [lineWrap, setLineWrap] = useState(true)
  const virtualizedRef = useRef<VirtualizedTextViewHandle>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  
  
  const shouldVirtualize = file.size > VIRTUALIZATION_THRESHOLD_BYTES && !file.mimeType?.startsWith('image/')
  
  

  useEffect(() => {
    if (initialLineNumber && contentRef.current && !shouldVirtualize) {
      const lineHeight = 20
      const scrollPosition = (initialLineNumber - 1) * lineHeight
      setHighlightedLine(initialLineNumber)
      setTimeout(() => {
        contentRef.current?.scrollTo({ top: scrollPosition, behavior: 'smooth' })
      }, 100)
      setTimeout(() => {
        setHighlightedLine(undefined)
      }, 3000)
    }
  }, [initialLineNumber, shouldVirtualize, file.content])
  
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

  const handleEdit = () => {
    if (shouldVirtualize) {
      setViewMode('edit')
      const event = new CustomEvent('editModeChange', { detail: { isEditing: true } })
      window.dispatchEvent(event)
      return
    }
    
    try {
      const content = file.content ? decodeBase64(file.content) : ''
      setEditContent(content)
      setViewMode('edit')
      const event = new CustomEvent('editModeChange', { detail: { isEditing: true } })
      window.dispatchEvent(event)
    } catch (err) {
      console.error('Failed to load content for editing:', err)
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
      onFileSaved?.()
    } catch (err) {
      console.error('Failed to save file:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditContent('')
    setViewMode('preview')
    setHasVirtualizedChanges(false)
    const event = new CustomEvent('editModeChange', { detail: { isEditing: false } })
    window.dispatchEvent(event)
  }

  const handleVirtualizedSaveStateChange = useCallback((hasChanges: boolean) => {
    setHasVirtualizedChanges(hasChanges)
  }, [])

  const handleVirtualizedSave = useCallback(() => {
    setViewMode('preview')
    const editEvent = new CustomEvent('editModeChange', { detail: { isEditing: false } })
    window.dispatchEvent(editEvent)
    const event = new CustomEvent('fileSaved', { detail: { path: file.path } })
    window.dispatchEvent(event)
    onFileSaved?.()
  }, [file.path, onFileSaved])

  const isTextFile = file.mimeType?.startsWith('text/') || 
    ['application/json', 'application/xml', 'text/javascript', 'text/typescript'].includes(file.mimeType || '')

  const renderContent = () => {
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

    if (shouldVirtualize && isTextFile) {
      return (
        <VirtualizedTextView
          ref={virtualizedRef}
          filePath={file.path}
          totalLines={file.totalLines}
          editable={viewMode === 'edit'}
          onSaveStateChange={handleVirtualizedSaveStateChange}
          onSave={handleVirtualizedSave}
          className="h-full"
          initialLineNumber={initialLineNumber}
          lineWrap={lineWrap}
        />
      )
    }

    if (file.content === undefined) return null

    if (isTextFile) {
      if (viewMode === 'edit') {
        return (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className={`text-[16px] bg-muted text-foreground p-2 rounded font-mono w-full resize-none focus:outline-none focus:ring-0 border-none block ${
              lineWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
            }`}
            style={{ minHeight: '95vh' }}
            placeholder="Edit file content..."
            autoFocus
            data-file-editor="true"
          />
        )
      }
      
      try {
        const textContent = decodeBase64(file.content)
        if (!textContent) {
          return (
            <div className="text-center text-muted-foreground py-8">
              Empty file - click Edit to add content
            </div>
          )
        }
        const lines = textContent.split('\n')
        return (
          <div className={`pb-[200px] text-sm bg-muted text-foreground rounded font-mono ${
            lineWrap ? 'overflow-x-hidden' : 'overflow-x-auto'
          }`}>
            {lines.map((line, index) => {
              const lineNum = index + 1
              const isHighlighted = highlightedLine === lineNum
              return (
                <div 
                  key={index}
                  className={`flex transition-colors duration-300 ${isHighlighted ? 'bg-yellow-500/30' : ''}`}
                  style={{ minHeight: '20px', lineHeight: '20px' }}
                >
                  <span className="w-12 flex-shrink-0 text-right pr-3 text-muted-foreground select-none border-r border-border/50 text-xs">
                    {lineNum}
                  </span>
                  <pre className={`flex-1 pl-3 ${
                    lineWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                  }`}>
                    {line || ' '}
                  </pre>
                </div>
              )
            })}
          </div>
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

  const handleVirtualizedSaveClick = async () => {
    if (virtualizedRef.current) {
      setIsSaving(true)
      try {
        await virtualizedRef.current.save()
      } finally {
        setIsSaving(false)
      }
    }
  }

  const showSaveButton = viewMode === 'edit'
  const showCancelButton = viewMode === 'edit'

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
                {shouldVirtualize && (
                  <span className="text-xs text-blue-500 flex-shrink-0">Virtualized</span>
                )}
                {hasVirtualizedChanges && (
                  <span className="text-xs text-yellow-500 flex-shrink-0">Unsaved changes</span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-1 flex-shrink-0 mt-1">
              {isTextFile && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); setLineWrap(!lineWrap) }} 
                  className={`h-7 w-7 p-0 ${lineWrap ? 'bg-primary text-primary-foreground' : ''}`}
                  title={lineWrap ? "Disable line wrap" : "Enable line wrap"}
                >
                  <WrapText className="w-3 h-3" />
                </Button>
              )}
              
              {isTextFile && viewMode !== 'edit' && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleEdit() }} className="h-7 w-7 p-0">
                  <Edit3 className="w-3 h-3" />
                </Button>
              )}
              
              {showSaveButton && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (shouldVirtualize) { handleVirtualizedSaveClick(); } else { handleSave(); } }} disabled={isSaving || (shouldVirtualize && !hasVirtualizedChanges)} className="border-green-600 bg-green-600/10 text-green-600 hover:bg-green-600/20 h-7 w-7 p-0">
                  <Save className="w-3 h-3" />
                </Button>
              )}
              
              {showCancelButton && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleCancel() }} className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 h-7 w-7 p-0">
                  <XIcon className="w-3 h-3" />
                </Button>
              )}
              
              {viewMode !== 'edit' && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDownload() }} className="h-7 w-7 p-0">
                  <Download className="w-3 h-3" />
                </Button>
              )}
              
              {viewMode !== 'edit' && isMobileModal && onCloseModal && (
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCloseModal() }} className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 h-7 w-7 p-0">
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
      
      <div 
        ref={contentRef}
        className={`flex-1 ${viewMode === 'edit' && !shouldVirtualize ? 'overflow-hidden' : shouldVirtualize ? '' : 'overflow-y-auto overscroll-contain'} min-h-0 overflow-x-hidden`}
      >
        <div className={`${shouldVirtualize ? 'h-full' : 'p-2'} min-w-0`}>
          {renderContent()}
        </div>
      </div>
    </div>
  )
})
