import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSettings } from '@/hooks/useSettings'
import { Loader2, Plus, Trash2, Save, User, Key, Pencil } from 'lucide-react'
import { showToast } from '@/lib/toast'
import { GitCredentialDialog, type GitCredentialSaveOptions } from './GitCredentialDialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GitCredential, GitIdentity } from '@/api/types/settings'
import { listRepos, updateRepoGitCredential } from '@/api/repos'

function ensureCredentialId(credential: GitCredential): GitCredential {
  return credential.id ? credential : { ...credential, id: crypto.randomUUID() }
}

export function GitSettings() {
  const { t } = useTranslation()
  const { preferences, isLoading, updateSettingsAsync, isUpdating } = useSettings()
  const queryClient = useQueryClient()
  const [gitCredentials, setGitCredentials] = useState<GitCredential[]>([])
  const [gitIdentity, setGitIdentity] = useState<GitIdentity>({ name: '', email: '' })
  const [defaultGitCredentialId, setDefaultGitCredentialId] = useState<string | undefined>()
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isCredentialDialogOpen, setIsCredentialDialogOpen] = useState(false)
  const [editingCredentialIndex, setEditingCredentialIndex] = useState<number | null>(null)

  const { data: repos = [] } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })


  useEffect(() => {
    if (preferences) {
      setGitCredentials(preferences.gitCredentials || [])
      setGitIdentity(preferences.gitIdentity || { name: '', email: '' })
      setDefaultGitCredentialId(preferences.defaultGitCredentialId)
      setHasChanges(false)
    }
  }, [preferences])

  const checkForIdentityChanges = (newIdentity: GitIdentity) => {
    const currentIdentity = preferences?.gitIdentity || { name: '', email: '' }
    const identityChanged = currentIdentity.name !== newIdentity.name || currentIdentity.email !== newIdentity.email
    setHasChanges(identityChanged)
  }

  const openAddCredentialDialog = () => {
    setEditingCredentialIndex(null)
    setIsCredentialDialogOpen(true)
  }

  const openEditCredentialDialog = (index: number) => {
    setEditingCredentialIndex(index)
    setIsCredentialDialogOpen(true)
  }

  const handleEditClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    openEditCredentialDialog(index)
  }

  const handleDeleteClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    removeCredential(index)
  }

  const syncRepoAssignments = async (credentialId: string, repoIds: number[]) => {
    const selectedRepoIds = new Set(repoIds)
    const affectedRepos = repos.filter((repo) => selectedRepoIds.has(repo.id) || repo.gitCredentialId === credentialId)

    await Promise.all(
      affectedRepos.map((repo) => updateRepoGitCredential(
        repo.id,
        selectedRepoIds.has(repo.id) ? credentialId : undefined
      ))
    )
    await queryClient.invalidateQueries({ queryKey: ['repos'] })
  }

  const saveCredential = async (credential: GitCredential, options: GitCredentialSaveOptions) => {
    let newCredentials: GitCredential[]
    const nextCredential = ensureCredentialId(credential)
    const nextDefaultGitCredentialId = options.makeDefault ? nextCredential.id : defaultGitCredentialId === nextCredential.id ? undefined : defaultGitCredentialId

    if (editingCredentialIndex !== null) {
      newCredentials = [...gitCredentials]
      newCredentials[editingCredentialIndex] = nextCredential
    } else {
      newCredentials = [...gitCredentials, nextCredential]
    }

    setGitCredentials(newCredentials)
    setDefaultGitCredentialId(nextDefaultGitCredentialId)
    
    try {
      await updateSettingsAsync({ gitCredentials: newCredentials, defaultGitCredentialId: nextDefaultGitCredentialId, gitIdentity })
      await syncRepoAssignments(nextCredential.id!, options.repoIds)
      showToast.success(t('git.credentialSaved') || 'Credential saved')
    } catch {
      showToast.error(t('git.failedToSaveCredential') || 'Failed to save credential')
    }
  }

  const removeCredential = async (index: number) => {
    const removedCredentialId = gitCredentials[index]?.id
    const newCredentials = gitCredentials.filter((_, i) => i !== index)
    const nextDefaultGitCredentialId = newCredentials.some((credential) => credential.id === defaultGitCredentialId)
      ? defaultGitCredentialId
      : undefined
    setGitCredentials(newCredentials)
    setDefaultGitCredentialId(nextDefaultGitCredentialId)

    try {
      await updateSettingsAsync({ gitCredentials: newCredentials, defaultGitCredentialId: nextDefaultGitCredentialId, gitIdentity })
      if (removedCredentialId) {
        await syncRepoAssignments(removedCredentialId, [])
      }
      showToast.success(t('git.credentialDeleted') || 'Credential deleted')
    } catch {
      showToast.error(t('git.failedToDeleteCredential') || 'Failed to delete credential')
    }
  }

  const updateIdentity = (field: keyof GitIdentity, value: string) => {
    const newIdentity = { ...gitIdentity, [field]: value }
    setGitIdentity(newIdentity)
    checkForIdentityChanges(newIdentity)
  }

  const saveAll = async () => {
    setIsSaving(true)
    try {
      showToast.loading(t('git.savingConfig') || 'Saving git configuration...', { id: 'git-config' })
      const result = await updateSettingsAsync({ gitCredentials, defaultGitCredentialId, gitIdentity })
      setHasChanges(false)
      if (result.reloadError) {
        showToast.success(t('git.configSavedReload') || 'Git configuration saved (server reload pending)', { id: 'git-config' })
      } else {
        showToast.success(t('git.configSaved') || 'Git configuration saved', { id: 'git-config' })
      }
    } catch {
      showToast.error(t('git.failedToSaveConfig') || 'Failed to save git configuration', { id: 'git-config' })
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
          <h2 className="text-lg font-semibold text-foreground">{t('git.settings')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('git.manageIdentity') || 'Manage your git identity and credentials for repository operations'}
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
            {t('common.save')}
          </Button>
        )}
      </div>

       <div className="divide-y divide-border space-y-4 pb-4">
         <div>
            <div className="flex items-center gap-3 px-6 py-3">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{t('git.identity') || 'Identity'}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {gitIdentity.name || gitIdentity.email ? `${gitIdentity.name || t('git.noName') || 'No name'} <${gitIdentity.email || t('git.noEmail') || 'No email'}>` : t('git.notConfigured') || 'Not configured'}
              </span>
            </div>

            <div className="px-6 space-y-4 sm:ml-7">
              <p className="text-sm text-muted-foreground">
                {t('git.identityDescription') || 'Author identity used for git commits. Leave empty to use system defaults.'}
              </p>
             <div className="grid pb-4 grid-cols-1 sm:grid-cols-2 gap-4">
               <div className="space-y-2">
                 <Label htmlFor="git-name">{t('git.name')}</Label>
                 <Input
                   id="git-name"
                   placeholder={t('git.namePlaceholder') || 'Your Name'}
                   value={gitIdentity.name}
                   onChange={(e) => updateIdentity('name', e.target.value)}
                   disabled={isSaving}
                   className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                 />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="git-email">{t('git.email')}</Label>
                 <Input
                   id="git-email"
                   type="email"
                   placeholder={t('git.emailPlaceholder') || 'you@example.com'}
                   value={gitIdentity.email}
                   onChange={(e) => updateIdentity('email', e.target.value)}
                   disabled={isSaving}
                   className="bg-background border-border text-foreground placeholder:text-muted-foreground"
                 />
               </div>
             </div>
           </div>
         </div>

         <div>
            <div className="flex items-center gap-3 px-6 py-3">
              <Key className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{t('git.credentials') || 'Credentials'}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {t('git.credentialsCount', { count: gitCredentials.length }) || `${gitCredentials.length} configured`}
              </span>
            </div>

            <div className="px-6 space-y-4 sm:ml-7">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('git.credentialsDescription') || 'Credentials for cloning private repositories'}
                </p>
               <Button
                 type="button"
                 variant="outline"
                 size="sm"
                 onClick={openAddCredentialDialog}
                 disabled={isSaving}
               >
                 <Plus className="h-4 w-4 mr-2" />
                 {t('common.add') || 'Add'}
                </Button>
              </div>

              {gitCredentials.length === 0 ? (
               <div className="rounded-lg border border-dashed border-border p-4 text-center">
                 <p className="text-sm text-muted-foreground">
                   {t('git.noCredentials') || 'No credentials configured. Click "Add" to add credentials.'}
                 </p>
               </div>
             ) : (
               <div className="border border-border rounded-lg overflow-hidden">
                 <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                     <tr>
                       <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('common.name')}</th>
                       <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">{t('git.host') || 'Host'}</th>
                       <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">{t('common.type')}</th>
                       <th className="px-3 py-2 text-right font-medium text-muted-foreground">{t('common.actions')}</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-border">
                     {gitCredentials.map((cred, index) => (
                       <tr key={index} className="hover:bg-accent/30 transition-colors">
                         <td className="px-3 py-2">
                           <div>
                             <span className="font-medium">{cred.name || t('git.unnamed') || 'Unnamed'}</span>
                             <div className="text-xs text-muted-foreground sm:hidden">{cred.host}</div>
                           </div>
                         </td>
                         <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                           {cred.host}
                         </td>
                        <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                            {cred.type === 'ssh' ? 'SSH' : 'PAT'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={(e) => handleEditClick(e, index)}
                                disabled={isSaving}
                                title={t('common.edit')}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={(e) => handleDeleteClick(e, index)}
                                disabled={isSaving}
                                title={t('common.delete')}
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
         </div>
       </div>

        <GitCredentialDialog
         open={isCredentialDialogOpen}
         onOpenChange={setIsCredentialDialogOpen}
          onSave={saveCredential}
          credential={editingCredentialIndex !== null ? gitCredentials[editingCredentialIndex] : undefined}
          repos={repos}
          assignedRepoIds={editingCredentialIndex !== null && gitCredentials[editingCredentialIndex]?.id
            ? repos.filter((repo) => repo.gitCredentialId === gitCredentials[editingCredentialIndex]?.id).map((repo) => repo.id)
            : []}
          isDefault={editingCredentialIndex !== null && !!gitCredentials[editingCredentialIndex]?.id && defaultGitCredentialId === gitCredentials[editingCredentialIndex]?.id}
          isSaving={isSaving || isUpdating}
        />
    </div>
  )
}
