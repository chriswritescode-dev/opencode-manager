import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getRepoDisplayName } from '@/lib/utils'
import { settingsApi } from '@/api/settings'
import { listRepos } from '@/api/repos'
import { FetchError } from '@/api/fetchWrapper'
import { toast } from 'sonner'
import type { SkillScope } from '@opencode-manager/shared'
import type { Repo } from '@/api/types'

interface SkillInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled: () => void
}

export function SkillInstallDialog({ open, onOpenChange, onInstalled }: SkillInstallDialogProps) {
  const { t } = useTranslation()
  const [sourceType, setSourceType] = useState<'github' | 'upload'>('github')
  const [url, setUrl] = useState('')
  const [scope, setScope] = useState<SkillScope>('global')
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)
  const [files, setFiles] = useState<File[]>([])
  const [overwrite, setOverwrite] = useState(false)

  useEffect(() => {
    setOverwrite(false)
  }, [url, files, sourceType, scope, selectedRepoId])

  const resetForm = () => {
    setUrl('')
    setScope('global')
    setSelectedRepoId(undefined)
    setFiles([])
    setOverwrite(false)
  }

  const { data: repos = [] } = useQuery<Repo[]>({
    queryKey: ['repos'],
    queryFn: listRepos,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const installMutation = useMutation({
    mutationFn: () => {
      if (sourceType === 'github') {
        return settingsApi.installSkillFromGithub({
          sourceType,
          url,
          scope,
          repoId: scope === 'project' ? selectedRepoId : undefined,
          overwrite: overwrite || undefined,
        })
      }
      return settingsApi.installSkillFromUpload({
        files,
        scope,
        repoId: scope === 'project' ? selectedRepoId : undefined,
        overwrite: overwrite || undefined,
      })
    },
    onSuccess: () => {
      toast.success(t('settings.skillInstallSuccess') || 'Skill installed successfully')
      resetForm()
      onInstalled()
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof FetchError && error.statusCode === 409) {
        setOverwrite(true)
        return
      }
      toast.error(error instanceof Error ? error.message : t('settings.skillInstallFailed') || 'Failed to install skill')
    },
  })

  const handleSubmit = () => {
    if (sourceType === 'github' && !url.trim()) {
      toast.error(t('settings.enterGitHubUrl') || 'Please enter a GitHub URL')
      return
    }
    if (sourceType === 'upload' && files.length === 0) {
      toast.error(t('settings.selectFileFirst') || 'Please select at least one file')
      return
    }
    if (scope === 'project' && !selectedRepoId) {
      toast.error(t('settings.selectRepository') || 'Please select a repository')
      return
    }
    installMutation.mutate()
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetForm()
    }
    onOpenChange(isOpen)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (selectedFiles) {
      setFiles(Array.from(selectedFiles))
    }
  }

  const selectedFileSummary = () => {
    if (files.length === 0) return null
    const relPath = files[0].webkitRelativePath || files[0].name
    return (
      <p className="text-sm text-muted-foreground">
        {files.length} {files.length > 1 ? t('common.files') || 'files' : t('common.file') || 'file'} {t('common.selected')} ({t('common.first') || 'first'}: {relPath})
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-lg sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{t('settings.installSkill')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <div className="space-y-4">
            <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as 'github' | 'upload')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="github">{t('settings.githubUrl')}</TabsTrigger>
                <TabsTrigger value="upload">{t('common.upload')}</TabsTrigger>
              </TabsList>

              <TabsContent value="github" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>{t('settings.githubUrl')}</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t('settings.pasteGitHubUrl')}
                  />
                </div>
              </TabsContent>

              <TabsContent value="upload" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>{t('settings.skillFile')}</Label>
                  <Input
                    type="file"
                    accept=".md,text/markdown"
                    onChange={handleFileChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.skillFolder')}</Label>
                  <Input
                    type="file"
                    accept=".md,text/markdown"
                    {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
                    onChange={handleFileChange}
                  />
                </div>
                {selectedFileSummary()}
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label>{t('settings.scope')}</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as SkillScope)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('settings.selectScope')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">{t('settings.global')}</SelectItem>
                  <SelectItem value="project">{t('settings.project')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === 'project' && (
              <div className="space-y-2">
                <Label>{t('repo.selectRepo')}</Label>
                <Select
                  value={selectedRepoId?.toString()}
                  onValueChange={(value) => setSelectedRepoId(value ? parseInt(value, 10) : undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('settings.selectRepository')} />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id.toString()}>
                        {getRepoDisplayName(repo)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {overwrite && (
              <Alert>
                <AlertDescription>
                  {t('settings.skillOverwriteHint') || 'A skill with this name already exists. Install again to overwrite the managed skill directory.'}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end pb-4 p-3">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={installMutation.isPending}
            className="flex-1 sm:flex-none"
          >
            {installMutation.isPending && `${t('common.loading')}...`}
            {!installMutation.isPending && (overwrite ? t('settings.overwriteAndInstall') || 'Overwrite and install' : t('settings.install') || 'Install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
