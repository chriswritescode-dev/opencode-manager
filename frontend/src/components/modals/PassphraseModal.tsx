import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, AlertCircle } from 'lucide-react'

interface PassphraseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (passphrase: string) => void
  credentialName?: string
}

export function PassphraseModal({ open, onOpenChange, onSubmit, credentialName = 'SSH key' }: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setPassphrase('')
      setError(null)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const handleSubmit = () => {
    if (!passphrase.trim()) {
      setError('Passphrase is required')
      return
    }
    
    onSubmit(passphrase)
    setPassphrase('')
    setError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90%] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            SSH Key Passphrase Required
          </DialogTitle>
          <DialogDescription>
            Enter the passphrase for your <span className="font-medium">{credentialName}</span>
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="passphrase">Passphrase</Label>
            <div className="relative">
              <Input
                id="passphrase"
                type="password"
                ref={inputRef}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter your passphrase"
                className={error ? 'border-destructive' : ''}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            )}
          </div>
          
          <p className="text-xs text-muted-foreground">
            This passphrase is NOT stored and will be required each time you access this SSH key.
          </p>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!passphrase.trim()}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
