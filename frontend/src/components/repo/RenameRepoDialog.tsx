import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { X, Check } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface RenameRepoDialogProps {
  isOpen: boolean
  currentName: string
  derivedName: string
  onClose: () => void
  onSave: (name: string | null) => void
}

export function RenameRepoDialog({
  isOpen,
  currentName,
  derivedName,
  onClose,
  onSave,
}: RenameRepoDialogProps) {
  const [editName, setEditName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setEditName(currentName)
    }
  }, [isOpen, currentName])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = editName.trim()
    onSave(trimmed.length > 0 ? trimmed : null)
    onClose()
  }

  const handleCancel = () => {
    setEditName(currentName)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        hideCloseButton
        mobileFullscreen
        className="gap-0 p-4 sm:p-6"
      >
        <DialogHeader>
          <DialogTitle className="text-sm text-muted-foreground font-normal">Rename repository</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-w-0">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={derivedName}
              className="text-base font-semibold bg-background border border-border rounded px-3 py-2.5 pr-10 outline-none w-full focus:border-primary focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            {editName && (
              <button
                type="button"
                aria-label="Clear"
                onClick={() => {
                  setEditName('')
                  inputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-red-500/10 text-red-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="flex-1 h-10"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 h-10"
            >
              <Check className="w-4 h-4 mr-2" />
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
