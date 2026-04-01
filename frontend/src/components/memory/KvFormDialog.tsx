import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateKvEntry, useUpdateKvEntry } from '@/hooks/useMemories'
import type { KvEntry, CreateKvEntryRequest, UpdateKvEntryRequest } from '@opencode-manager/shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

const kvSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  data: z.string().min(1, 'Data is required'),
  ttlHours: z.number().optional(),
})

type KvFormData = z.infer<typeof kvSchema>

interface KvFormDialogProps {
  entry?: KvEntry
  projectId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KvFormDialog({ entry, projectId, open, onOpenChange }: KvFormDialogProps) {
  const createMutation = useCreateKvEntry()
  const updateMutation = useUpdateKvEntry()

  const [jsonError, setJsonError] = useState<string | undefined>()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<KvFormData>({
    resolver: zodResolver(kvSchema),
    defaultValues: {
      key: '',
      data: '',
      ttlHours: undefined,
    },
  })

  useEffect(() => {
    if (open) {
      if (entry) {
        const ttlMs = entry.expiresAt - entry.updatedAt
        const ttlHoursValue = ttlMs > 0 && ttlMs < Number.MAX_SAFE_INTEGER
          ? Math.round(ttlMs / (1000 * 60 * 60))
          : undefined

        reset({
          key: entry.key,
          data: JSON.stringify(entry.data, null, 2),
          ttlHours: ttlHoursValue,
        })
      } else {
        reset({
          key: '',
          data: '',
          ttlHours: undefined,
        })
      }
      setJsonError(undefined)
    }
  }, [open, entry, reset])

  const validateJson = (value: string): boolean => {
    try {
      JSON.parse(value)
      setJsonError(undefined)
      return true
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON')
      return false
    }
  }

  const onSubmit = async (data: KvFormData) => {
    if (!validateJson(data.data)) {
      return
    }

    const parsedData = JSON.parse(data.data)
    const ttlMs = data.ttlHours ? data.ttlHours * 1000 * 60 * 60 : undefined

    if (entry) {
      const updateData: UpdateKvEntryRequest = {
        data: parsedData,
        ttlMs,
      }
      await updateMutation.mutateAsync({ projectId: projectId!, key: entry.key, data: updateData })
    } else if (projectId) {
      const createData: CreateKvEntryRequest = {
        projectId,
        key: data.key,
        data: parsedData,
        ttlMs,
      }
      await createMutation.mutateAsync(createData)
    }
    onOpenChange(false)
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit KV Entry' : 'Create KV Entry'}</DialogTitle>
          <DialogDescription>
            {entry
              ? 'Update the KV entry data and TTL.'
              : 'Add a new key-value entry to store project data.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key">Key</Label>
            <Input
              id="key"
              {...register('key')}
              placeholder="Enter key..."
              disabled={!!entry}
            />
            {errors.key && (
              <p className="text-sm text-destructive">{errors.key.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="data">Data (JSON)</Label>
            <Textarea
              id="data"
              {...register('data')}
              placeholder='{"key": "value"}'
              rows={6}
              className="resize-none font-mono"
              onBlur={(e) => validateJson(e.target.value)}
            />
            {errors.data && (
              <p className="text-sm text-destructive">{errors.data.message}</p>
            )}
            {jsonError && (
              <p className="text-sm text-destructive">{jsonError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ttlHours">TTL (hours, optional)</Label>
            <Input
              id="ttlHours"
              type="number"
              min="0"
              step="1"
              {...register('ttlHours', { valueAsNumber: true })}
              placeholder="Enter TTL in hours..."
            />
          </div>

          <DialogFooter className='flex gap-2 flex-wrap'>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !!jsonError}>
              {isLoading ? 'Saving...' : entry ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
