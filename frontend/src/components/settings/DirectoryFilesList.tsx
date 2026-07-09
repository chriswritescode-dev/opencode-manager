import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { SettingsListRow } from '@/components/ui/settings-list'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import type { OpenCodeDirectoryFileInfo } from '@/api/types/settings'

interface DirectoryFilesListProps {
  kind: 'agents' | 'commands'
  files: OpenCodeDirectoryFileInfo[]
  titlePrefix?: string
}

export function DirectoryFilesList({ kind, files, titlePrefix = '' }: DirectoryFilesListProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editingFile, setEditingFile] = useState<OpenCodeDirectoryFileInfo | null>(null)
  const [deletingFile, setDeletingFile] = useState<OpenCodeDirectoryFileInfo | null>(null)
  const [content, setContent] = useState('')

  const { isFetching: isLoadingContent } = useQuery({
    queryKey: ['opencode-directory-file', kind, editingFile?.relativePath],
    queryFn: async () => {
      const result = await settingsApi.getOpenCodeDirectoryFile(kind, editingFile!.relativePath)
      setContent(result.content)
      return result
    },
    enabled: !!editingFile,
    staleTime: 0,
    gcTime: 0,
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      settingsApi.updateOpenCodeDirectoryFile({
        kind,
        relativePath: editingFile!.relativePath,
        content,
      }),
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('common.saved') || 'File saved')
      setEditingFile(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('common.failedToSave') || 'Failed to save file')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => settingsApi.deleteOpenCodeDirectoryFile(kind, deletingFile!.relativePath),
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      toast.success(t('common.deleted') || 'File deleted')
      setDeletingFile(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t('common.failedToDelete') || 'Failed to delete file')
    },
  })

  return (
    <>
      {files.map((file) => (
        <SettingsListRow
          key={`file:${file.relativePath}`}
          title={`${titlePrefix}${file.name}`}
          description={`${t('common.uploaded') || 'Uploaded file'}: ${file.relativePath}`}
          badges={<Badge variant="secondary" className="shrink-0">{t('common.file') || 'File'}</Badge>}
          onClick={() => setEditingFile(file)}
          primaryAction={{ label: t('common.edit'), onClick: () => setEditingFile(file) }}
          actions={[{ label: t('common.delete'), destructive: true, onClick: () => setDeletingFile(file) }]}
          actionsLabel={`${t('common.actions')} ${t('for') || 'for'} ${file.name}`}
        />
      ))}

      <Dialog open={!!editingFile} onOpenChange={(open) => !open && setEditingFile(null)}>
        <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
          <DialogHeader className="p-4 sm:p-6 border-b">
            <DialogTitle className="truncate">{editingFile?.relativePath}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-2 sm:p-4">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isLoadingContent}
              rows={18}
              className="font-mono md:text-sm"
            />
          </div>

          <DialogFooter className="flex flex-row gap-2 pt-2 border-t border-border sm:justify-end pb-4 p-3">
            <Button variant="outline" onClick={() => setEditingFile(null)} className="flex-1 sm:flex-none">
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={isLoadingContent || updateMutation.isPending}
              className="flex-1 sm:flex-none"
            >
              {updateMutation.isPending ? `${t('common.saving') || 'Saving'}...` : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deletingFile}
        onOpenChange={(open) => !open && setDeletingFile(null)}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeletingFile(null)}
        title={t('settings.deleteFile')}
        description={t('settings.deleteFileConfirm') || 'Are you sure you want to delete this uploaded file?'}
        itemName={deletingFile?.relativePath}
        isDeleting={deleteMutation.isPending}
      />
    </>
  )
}
