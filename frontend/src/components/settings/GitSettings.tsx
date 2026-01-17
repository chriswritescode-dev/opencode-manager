import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Loader2, Plus, Trash2, Save, Check, X, TestTube, ChevronDown, ChevronRight, User, Key, Pencil } from 'lucide-react'
import { showToast } from '@/lib/toast'
import { GitCredentialDialog } from './GitCredentialDialog'
import { settingsApi } from '@/api/settings'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GitCredential, GitIdentity } from '@/api/types/settings'

export function GitSettings() {
  const { preferences, isLoading, updateSettingsAsync, isUpdating } = useSettings()
  const [gitCredentials, setGitCredentials] = useState<GitCredential[]>([])
  const [gitIdentity, setGitIdentity] = useState<GitIdentity>({ name: '', email: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isCredentialDialogOpen, setIsCredentialDialogOpen] = useState(false)
  const [editingCredentialIndex, setEditingCredentialIndex] = useState<number | null>(null)
  const [testingCredentialIndex, setTestingCredentialIndex] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message?: string }>>({})
  const [identityExpanded, setIdentityExpanded] = useState(true)
  const [credentialsExpanded, setCredentialsExpanded] = useState(true)

  useEffect(() => {
    if (preferences) {
      setGitCredentials(preferences.gitCredentials || [])
      setGitIdentity(preferences.gitIdentity || { name: '', email: '' })
      setHasChanges(false)
    }
  }, [preferences])

  const checkForChanges = (newCredentials: GitCredential[], newIdentity: GitIdentity) => {
    const currentCreds = JSON.stringify(preferences?.gitCredentials || [])
    const newCreds = JSON.stringify(newCredentials)
    const currentIdentity = preferences?.gitIdentity || { name: '', email: '' }
    const identityChanged = currentIdentity.name !== newIdentity.name || currentIdentity.email !== newIdentity.email
    setHasChanges(currentCreds !== newCreds || identityChanged)
  }

  const openAddCredentialDialog = () => {
    setEditingCredentialIndex(null)
    setIsCredentialDialogOpen(true)
  }

  const openEditCredentialDialog = (index: number) => {
    setEditingCredentialIndex(index)
    setIsCredentialDialogOpen(true)
  }

  const saveCredential = async (credential: GitCredential) => {
    let newCredentials: GitCredential[]

    if (editingCredentialIndex !== null) {
      newCredentials = [...gitCredentials]
      newCredentials[editingCredentialIndex] = credential
    } else {
      newCredentials = [...gitCredentials, credential]
    }

    setGitCredentials(newCredentials)
    checkForChanges(newCredentials, gitIdentity)
    clearTestResult(editingCredentialIndex ?? newCredentials.length - 1)
  }

  const removeCredential = (index: number) => {
    const newCredentials = gitCredentials.filter((_, i) => i !== index)
    setGitCredentials(newCredentials)
    checkForChanges(newCredentials, gitIdentity)
    clearTestResult(index)
  }

  const updateIdentity = (field: keyof GitIdentity, value: string) => {
    const newIdentity = { ...gitIdentity, [field]: value }
    setGitIdentity(newIdentity)
    checkForChanges(gitCredentials, newIdentity)
  }

  const testCredential = async (index: number) => {
    const credential = gitCredentials[index]
    if (!credential) return

    setTestingCredentialIndex(index)
    try {
      const result = await settingsApi.testGitCredential(credential)
      setTestResults(prev => ({
        ...prev,
        [index]: {
          success: result.success,
          message: result.error
        }
      }))

      if (result.success) {
        if (result.maskedToken) {
          const updatedCredentials = [...gitCredentials]
          updatedCredentials[index] = {
            ...credential,
            token: result.maskedToken
          }
          setGitCredentials(updatedCredentials)
        }
        showToast.success(`Successfully connected to ${credential.host}`)
      } else {
        showToast.error(`Connection failed: ${result.error || 'Unknown error'}`)
      }
    } catch {
      const errorMsg = 'Failed to test credential'
      setTestResults(prev => ({ ...prev, [index]: { success: false, message: errorMsg } }))
      showToast.error(errorMsg)
    } finally {
      setTestingCredentialIndex(null)
    }
  }

  const clearTestResult = (index: number) => {
    setTestResults(prev => {
      const newResults = { ...prev }
      delete newResults[index]
      return newResults
    })
  }

  const saveAll = async () => {
    setIsSaving(true)
    try {
      showToast.loading('Saving git configuration...', { id: 'git-config' })
      await updateSettingsAsync({ gitCredentials, gitIdentity })
      setHasChanges(false)
      showToast.success('Git configuration saved', { id: 'git-config' })
    } catch {
      showToast.error('Failed to save git configuration', { id: 'git-config' })
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
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Git Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Manage your git identity and credentials for repository operations
          </p>
        </div>
        {hasChanges && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={saveAll}
            disabled={isSaving || isUpdating}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        )}
      </div>

      <div className="divide-y divide-border">
        <div>
          <button
            className="w-full flex items-center gap-3 px-6 py-3 hover:bg-accent/30 transition-colors"
            onClick={() => setIdentityExpanded(!identityExpanded)}
          >
            {identityExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Identity</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {gitIdentity.name || gitIdentity.email ? `${gitIdentity.name || 'No name'} <${gitIdentity.email || 'No email'}>` : 'Not configured'}
            </span>
          </button>

          {identityExpanded && (
            <div className="px-6 pb-4 pt-2 space-y-4 ml-7">
              <p className="text-sm text-muted-foreground">
                Author identity used for git commits. Leave empty to use system defaults.
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
            </div>
          )}
        </div>

        <div>
          <button
            className="w-full flex items-center gap-3 px-6 py-3 hover:bg-accent/30 transition-colors"
            onClick={() => setCredentialsExpanded(!credentialsExpanded)}
          >
            {credentialsExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <Key className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Credentials</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {gitCredentials.length} configured
            </span>
          </button>

          {credentialsExpanded && (
            <div className="px-6 pb-4 pt-2 space-y-4 ml-7">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Credentials for cloning private repositories
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openAddCredentialDialog}
                  disabled={isSaving}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>

              {gitCredentials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    No credentials configured. Click "Add" to add credentials.
                  </p>
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Host</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Status</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {gitCredentials.map((cred, index) => (
                        <tr key={index} className="hover:bg-accent/30 transition-colors">
                          <td className="px-3 py-2">
                            <div>
                              <span className="font-medium">{cred.name || 'Unnamed'}</span>
                              <div className="text-xs text-muted-foreground sm:hidden">{cred.host}</div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                            {cred.host}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {testResults[index] && (
                              <span className={cn(
                                'inline-flex items-center gap-1 text-xs',
                                testResults[index].success ? 'text-green-500' : 'text-red-500'
                              )}>
                                {testResults[index].success ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => testCredential(index)}
                                disabled={testingCredentialIndex === index}
                                title="Test"
                              >
                                {testingCredentialIndex === index ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <TestTube className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => openEditCredentialDialog(index)}
                                disabled={isSaving}
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => removeCredential(index)}
                                disabled={isSaving}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <GitCredentialDialog
        open={isCredentialDialogOpen}
        onOpenChange={setIsCredentialDialogOpen}
        onSave={saveCredential}
        credential={editingCredentialIndex !== null ? gitCredentials[editingCredentialIndex] : undefined}
        isSaving={isSaving}
      />
    </div>
  )
}
