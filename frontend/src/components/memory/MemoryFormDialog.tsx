import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateMemory, useUpdateMemory } from '@/hooks/useMemories'
import type { Memory, CreateMemoryRequest, UpdateMemoryRequest } from '@opencode-manager/shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const memorySchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
  scope: z.enum(['convention', 'decision', 'context']),
})

type MemoryFormData = z.infer<typeof memorySchema>

interface MemoryFormDialogProps {
  memory?: Memory
  projectId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MemoryFormDialog({ memory, projectId, open, onOpenChange }: MemoryFormDialogProps) {
  const createMutation = useCreateMemory()
  const updateMutation = useUpdateMemory()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<MemoryFormData>({
    resolver: zodResolver(memorySchema),
    defaultValues: {
      content: '',
      scope: 'context',
    },
  })

  const selectedScope = watch('scope')

  useEffect(() => {
    if (open) {
      if (memory) {
        reset({
          content: memory.content,
          scope: memory.scope,
        })
      } else {
        reset({
          content: '',
          scope: 'context',
        })
      }
    }
  }, [open, memory, reset])

  const onSubmit = async (data: MemoryFormData) => {
    if (memory) {
      const updateData: UpdateMemoryRequest = {
        content: data.content,
        scope: data.scope,
      }
      await updateMutation.mutateAsync({ id: memory.id, data: updateData })
    } else if (projectId) {
      const createData: CreateMemoryRequest = {
        projectId,
        content: data.content,
        scope: data.scope,
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
          <DialogTitle>{memory ? 'Edit Memory' : 'Create Memory'}</DialogTitle>
          <DialogDescription>
            {memory
              ? 'Update the memory content and scope.'
              : 'Add a new memory to store project knowledge.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scope">Scope</Label>
            <Select
              value={selectedScope}
              onValueChange={(value) => setValue('scope', value as MemoryFormData['scope'])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="convention">Convention</SelectItem>
                <SelectItem value="decision">Decision</SelectItem>
                <SelectItem value="context">Context</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              {...register('content')}
              placeholder="Enter memory content..."
              rows={5}
              className="resize-none"
            />
            {errors.content && (
              <p className="text-sm text-destructive">{errors.content.message}</p>
            )}
          </div>

          <DialogFooter className='flex gap-2 flex-wrap'>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : memory ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
