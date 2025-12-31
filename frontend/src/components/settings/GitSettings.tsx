import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Loader2, Plus, Trash2, Save } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'
import type { GitCredential, GitIdentity } from '@/api/types/settings'

export function GitSettings() {
  const { preferences, isLoading, updateSettingsAsync, isUpdating } = useSettings()
  const [gitCredentials, setGitCredentials] = useState<GitCredential[]>([])
  const [gitIdentity, setGitIdentity] = useState<GitIdentity>({ name: '', email: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [hasCredentialChanges, setHasCredentialChanges] = useState(false)
  const [hasIdentityChanges, setHasIdentityChanges] = useState(false)

  useEffect(() => {
    if (preferences) {
      setGitCredentials(preferences.gitCredentials || [])
      setGitIdentity(preferences.gitIdentity || { name: '', email: '' })
      setHasCredentialChanges(false)
      setHasIdentityChanges(false)
    }
  }, [preferences])

  const checkForCredentialChanges = (newCredentials: GitCredential[]) => {
    const currentCreds = JSON.stringify(preferences?.gitCredentials || [])
    const newCreds = JSON.stringify(newCredentials)
    setHasCredentialChanges(currentCreds !== newCreds)
  }

  const checkForIdentityChanges = (newIdentity: GitIdentity) => {
    const currentIdentity = preferences?.gitIdentity || { name: '', email: '' }
    setHasIdentityChanges(
      currentIdentity.name !== newIdentity.name || 
      currentIdentity.email !== newIdentity.email
    )
  }

  const addCredential = () => {
    const newCredentials = [...gitCredentials, { name: '', host: '', token: '', username: '' }]
    setGitCredentials(newCredentials)
    checkForCredentialChanges(newCredentials)
  }

  const updateCredential = (index: number, field: keyof GitCredential, value: string) => {
    const newCredentials = [...gitCredentials]
    newCredentials[index] = { ...newCredentials[index], [field]: value }
    setGitCredentials(newCredentials)
    checkForCredentialChanges(newCredentials)
  }

  const removeCredential = (index: number) => {
    const newCredentials = gitCredentials.filter((_, i) => i !== index)
    setGitCredentials(newCredentials)
    checkForCredentialChanges(newCredentials)
  }

  const updateIdentity = (field: keyof GitIdentity, value: string) => {
    const newIdentity = { ...gitIdentity, [field]: value }
    setGitIdentity(newIdentity)
    checkForIdentityChanges(newIdentity)
  }

  const saveCredentials = async () => {
    const validCredentials = gitCredentials.filter(cred => cred.name && cred.host && cred.token)
    
    setIsSaving(true)
    try {
      showToast.loading('Saving credentials and restarting server...', { id: 'git-credentials' })
      await updateSettingsAsync({ gitCredentials: validCredentials })
      setHasCredentialChanges(false)
      showToast.success('Git credentials updated', { id: 'git-credentials' })
    } catch {
      showToast.error('Failed to update git credentials', { id: 'git-credentials' })
    } finally {
      setIsSaving(false)
    }
  }

  const saveIdentity = async () => {
    setIsSaving(true)
    try {
      showToast.loading('Saving git identity...', { id: 'git-identity' })
      await updateSettingsAsync({ gitIdentity })
      setHasIdentityChanges(false)
      showToast.success('Git identity updated', { id: 'git-identity' })
    } catch {
      showToast.error('Failed to update git identity', { id: 'git-identity' })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-6">Git Identity</h2>
        
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure the default author identity used for git commits in local repositories.
            Leave empty to use system defaults.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="git-name">Name</Label>
              <Input
                id="git-name"
                placeholder="Your Name"
                value={gitIdentity.name}
                onChange={(e) => updateIdentity('name', e.target.value)}
                disabled={isSaving}
                className="bg-background border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="git-email">Email</Label>
              <Input
                id="git-email"
                type="email"
                placeholder="you@example.com"
                value={gitIdentity.email}
                onChange={(e) => updateIdentity('email', e.target.value)}
                disabled={isSaving}
                className="bg-background border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          
          {hasIdentityChanges && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={saveIdentity}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Identity
              </Button>
            </div>
          )}
          
          <p className="text-xs text-muted-foreground">
            If not configured, defaults to "OpenCode User" and "opencode@localhost" for new local repositories.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Git Credentials</h2>
            <p className="text-sm text-muted-foreground">
              Add credentials for cloning private repositories from any Git host
            </p>
          </div>
          <div className="flex gap-2">
            {hasCredentialChanges && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={saveCredentials}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCredential}
              disabled={isSaving}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>
        </div>

        {gitCredentials.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No git credentials configured. Click "Add" to add credentials for GitHub, GitLab, Gitea, or other Git hosts.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {gitCredentials.map((cred, index) => (
              <div key={index} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Input
                    placeholder="Credential name (e.g., GitHub Personal, Work GitLab)"
                    value={cred.name}
                    onChange={(e) => updateCredential(index, 'name', e.target.value)}
                    disabled={isSaving}
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCredential(index)}
                    disabled={isSaving}
                    className="ml-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Host URL</Label>
                    <Input
                      placeholder="https://github.com/"
                      value={cred.host}
                      onChange={(e) => updateCredential(index, 'host', e.target.value)}
                      disabled={isSaving}
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Username (optional)</Label>
                    <Input
                      placeholder="Auto-detected if empty"
                      value={cred.username || ''}
                      onChange={(e) => updateCredential(index, 'username', e.target.value)}
                      disabled={isSaving}
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
                
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Access Token</Label>
                  <Input
                    type="password"
                    placeholder="Personal access token"
                    value={cred.token}
                    onChange={(e) => updateCredential(index, 'token', e.target.value)}
                    disabled={isSaving}
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        
        <p className="text-xs text-muted-foreground mt-4">
          Username defaults: github.com uses "x-access-token", gitlab.com uses "oauth2". For other hosts, specify your username if required.
        </p>

        {isUpdating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Saving...</span>
          </div>
        )}
      </div>
    </div>
  )
}
