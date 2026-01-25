import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { showToast } from '@/lib/toast'
import type { GitCredential } from '@/api/types/settings'

interface GitCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (credential: GitCredential) => Promise<void>
  credential?: GitCredential
  isSaving: boolean
}

export function GitCredentialDialog({ open, onOpenChange, onSave, credential, isSaving }: GitCredentialDialogProps) {
  const [formData, setFormData] = useState<GitCredential>({
    name: '',
    host: '',
    token: '',
    username: '',
  })
  const [tokenEdited, setTokenEdited] = useState(false)

  const maskToken = (token: string) => {
    if (!token) return ''
    if (token.length <= 8) return '•'.repeat(token.length)
    return token.slice(0, 4) + '•'.repeat(Math.min(token.length - 4, 12)) + '...'
  }

  useEffect(() => {
    if (open) {
      setTokenEdited(false)
      if (credential) {
        setFormData({
          ...credential,
          token: ''
        })
      } else {
        setFormData({ name: '', host: 'https://github.com', token: '', username: '' })
      }
    }
  }, [open, credential])

  const handleSubmit = async (event?: React.MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    
    const isEditing = !!credential
    const tokenRequired = isEditing ? tokenEdited : true
    
    if (!formData.name.trim() || !formData.host.trim() || (tokenRequired && !formData.token.trim())) {
      showToast.error('Please fill in all required fields')
      return
    }

    try {
      const dataToSave: GitCredential = {
        ...formData,
        token: (isEditing && !tokenEdited) ? credential.token : formData.token
      }
      await onSave(dataToSave)
      setFormData({ name: '', host: '', token: '', username: '' })
      onOpenChange(false)
    } catch {
      showToast.error('Failed to save credential')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{credential ? 'Edit Git Credential' : 'Add Git Credential'}</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cred-name">Name *</Label>
            <Input
              id="cred-name"
              placeholder="GitHub Personal, Work GitLab"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-host">Host URL *</Label>
            <Input
              id="cred-host"
              placeholder="https://github.com/"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-token">
              Access Token {credential && !tokenEdited ? '(unchanged)' : '*'}
            </Label>
            <Input
              id="cred-token"
              type="password"
              placeholder={credential ? maskToken(credential.token) : 'Personal access token'}
              value={formData.token}
              onChange={(e) => {
                setTokenEdited(true)
                setFormData({ ...formData, token: e.target.value })
              }}
              disabled={isSaving}
            />
            {credential && !tokenEdited && (
              <p className="text-xs text-muted-foreground">
                Leave empty to keep existing token
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-username">Username (optional)</Label>
            <Input
              id="cred-username"
              placeholder="Auto-detected if empty"
              value={formData.username || ''}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              disabled={isSaving}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !formData.name.trim() || !formData.host.trim() || (!credential && !formData.token.trim())}
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {credential ? 'Update' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
