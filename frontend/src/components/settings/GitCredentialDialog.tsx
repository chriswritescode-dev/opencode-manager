import { useState, useEffect } from 'react'
import { Loader2, Key, Lock, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
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
    type: 'pat',
    token: '',
    username: '',
    sshPrivateKey: '',
    passphrase: '',
  })
  const [tokenEdited, setTokenEdited] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [showPassphraseInput, setShowPassphraseInput] = useState(false)
  const [testPassphrase, setTestPassphrase] = useState('')

  const maskToken = (token: string) => {
    if (!token) return ''
    if (token.length <= 8) return '•'.repeat(token.length)
    return token.slice(0, 4) + '•'.repeat(Math.min(token.length - 4, 12)) + '...'
  }

  useEffect(() => {
    if (open) {
      setTokenEdited(false)
      setShowPassphraseInput(false)
      setTestPassphrase('')
      if (credential) {
        setFormData({
          ...credential,
          sshPrivateKey: '',
          token: credential.type === 'pat' ? '' : credential.token
        })
      } else {
        setFormData({
          name: '',
          host: 'github.com',
          type: 'pat',
          token: '',
          username: '',
          sshPrivateKey: '',
          passphrase: ''
        })
      }
    }
  }, [open, credential])

  const handleSubmit = async (event?: React.MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (!formData.name.trim() || !formData.host.trim()) {
      showToast.error('Name and host are required')
      return
    }

    if (formData.type === 'pat') {
      if (!formData.token?.trim()) {
        showToast.error('Token is required for PAT type')
        return
      }
    } else if (formData.type === 'ssh') {
      if (!formData.sshPrivateKey?.trim()) {
        showToast.error('SSH key is required for SSH type')
        return
      }
    }

    try {
      const dataToSave: GitCredential = {
        ...formData,
        hasPassphrase: formData.type === 'ssh' ? Boolean(formData.passphrase?.trim()) : false
      }
      if (formData.type === 'pat' && credential?.token && !tokenEdited) {
        dataToSave.token = credential.token
      }
      await onSave(dataToSave)
      setFormData({ name: '', host: '', type: 'pat', token: '', username: '', sshPrivateKey: '', passphrase: '' })
      onOpenChange(false)
    } catch {
      showToast.error('Failed to save credential')
    }
  }

  const handleTestConnection = async () => {
    if (!formData.sshPrivateKey?.trim()) {
      showToast.error('Please enter an SSH key first')
      return
    }

    setIsTesting(true)

    try {
      const host = formData.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const settingsApi = (await import('@/api/settings')).settingsApi
      const result = await settingsApi.testSSHConnection(
        host,
        formData.sshPrivateKey,
        testPassphrase || undefined
      )

      if (result.success) {
        showToast.success(result.message)
      } else {
        showToast.error(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to test SSH connection'
      showToast.error(message)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="max-w-lg z-[200] h-[90vh] sm:h-auto sm:max-h-[85vh] flex flex-col"
                      overlayClassName="z-[200]">
        <DialogHeader className="flex-shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-2 sm:pb-3">
          <DialogTitle>{credential ? 'Edit Git Credential' : 'Add Git Credential'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
              className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-2 sm:py-3 overflow-y-auto">
          <div className="space-y-4 sm:space-y-4 flex-shrink-0">
            <div className="space-y-2">
              <Label htmlFor="cred-name">Name *</Label>
              <Input
                id="cred-name"
                placeholder="GitHub Personal, Work GitLab"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isSaving}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cred-type">Authentication Type</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formData.type === 'pat' ? 'default' : 'outline'}
                  onClick={() => setFormData({
                    ...formData,
                    type: 'pat',
                    host: formData.type === 'pat' ? formData.host : 'github.com',
                    sshPrivateKey: '',
                    passphrase: ''
                  })}
                  disabled={isSaving}
                  className="flex-1"
                >
                  <Key className="h-4 w-4 mr-2" />
                  PAT
                </Button>
                <Button
                  type="button"
                  variant={formData.type === 'ssh' ? 'default' : 'outline'}
                  onClick={() => setFormData({
                    ...formData,
                    type: 'ssh',
                    host: formData.type === 'ssh' ? formData.host : 'git@github.com',
                    token: ''
                  })}
                  disabled={isSaving}
                  className="flex-1"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  SSH Key
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cred-host">Host *</Label>
              <Input
                id="cred-host"
                placeholder="github.com or git@github.com"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                disabled={isSaving}
                autoComplete="off"
              />
            </div>

            {formData.type === 'pat' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cred-token">
                    Access Token {credential?.token && !tokenEdited ? '(unchanged)' : '*'}
                  </Label>
                  <Input
                    id="cred-token"
                    type="password"
                    placeholder={credential?.token ? maskToken(credential.token) : 'Personal access token'}
                    value={formData.token || ''}
                    onChange={(e) => {
                      setTokenEdited(true)
                      setFormData({ ...formData, token: e.target.value })
                    }}
                    disabled={isSaving}
                    autoComplete="new-password"
                  />
                  {credential?.token && !tokenEdited && (
                    <p className="text-xs text-muted-foreground">
                      Leave empty to keep existing token
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cred-pat-username">Username (optional)</Label>
                  <Input
                    id="cred-pat-username"
                    placeholder="Auto-detected if empty"
                    value={formData.username || ''}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    disabled={isSaving}
                    autoComplete="off"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cred-ssh-key">SSH Private Key *</Label>
                  <Textarea
                    id="cred-ssh-key"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={formData.sshPrivateKey || ''}
                    onChange={(e) => setFormData({ ...formData, sshPrivateKey: e.target.value })}
                    disabled={isSaving}
                    rows={10}
                    className="font-mono text-xs sm:text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste your private key content here
                  </p>
                </div>

                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPassphraseInput(!showPassphraseInput)}
                    disabled={isSaving}
                    className="w-full"
                  >
                    {showPassphraseInput ? 'Remove' : 'Add'} Passphrase
                  </Button>
                </div>

                {showPassphraseInput && (
                  <div className="space-y-2">
                    <Label htmlFor="cred-passphrase">Passphrase</Label>
                    <Input
                      id="cred-passphrase"
                      type="password"
                      placeholder="Enter passphrase for SSH key"
                      value={formData.passphrase || ''}
                      onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                      disabled={isSaving}
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      This passphrase will be required for each git operation
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="test-passphrase">Passphrase for Test (if protected)</Label>
                  <Input
                    id="test-passphrase"
                    type="password"
                    placeholder="Enter passphrase to test connection"
                    value={testPassphrase}
                    onChange={(e) => setTestPassphrase(e.target.value)}
                    disabled={isTesting || isSaving}
                    autoComplete="new-password"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || isSaving || !formData.sshPrivateKey?.trim()}
                  className="w-full"
                >
                  {isTesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Test Connection
                </Button>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-sm font-medium">Security Notice</p>
                  <p className="text-xs mt-1">
                    Your private key will be encrypted at rest. Never share it with anyone.
                  </p>
                </Alert>
              </>
            )}
          </div>
        </form>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !formData.name.trim() || !formData.host.trim() ||
                     (formData.type === 'pat' && !formData.token?.trim()) ||
                     (formData.type === 'ssh' && !formData.sshPrivateKey?.trim())}
            className="flex-1 sm:flex-none"
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {credential ? 'Update' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
