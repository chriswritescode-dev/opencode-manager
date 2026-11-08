import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { UserOutputDefinitionInputSchema } from '@opencode-manager/shared/schemas'
import type { OutputDefinition, OutputDefinitionInput } from '@opencode-manager/shared/schemas'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createOutputDefinition,
  putOutputDefinition,
  toOutputDefinitionInput,
} from '@/api/outputDefinitions'

type RendererKind = 'template' | 'html'

interface OutputDefinitionEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing?: OutputDefinition | null
  onSaved: () => void
}

const NEW_DEFINITION_JSON = JSON.stringify(
  {
    id: 'my-output',
    label: 'My output',
    description: 'What this output shows',
    icon: 'FileText',
    params: [],
    instructions: 'Build the requested output from the session.',
    dataSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
    renderer: { kind: 'template' },
    generation: 'separateSession',
  },
  null,
  2,
)

function rendererKind(definition: OutputDefinition): RendererKind {
  return definition.renderer.kind === 'html' ? 'html' : 'template'
}

function toEditableJson(definition: OutputDefinition): string {
  return JSON.stringify(
    { ...toOutputDefinitionInput(definition), renderer: { kind: rendererKind(definition) } },
    null,
    2,
  )
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')
}

/** Dialog that creates or edits a global output definition from its JSON and renderer settings. */
export function OutputDefinitionEditor({ open, onOpenChange, editing, onSaved }: OutputDefinitionEditorProps) {
  const [definitionJson, setDefinitionJson] = useState(NEW_DEFINITION_JSON)
  const [kind, setKind] = useState<RendererKind>('template')
  const [templateHtml, setTemplateHtml] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setDefinitionJson(toEditableJson(editing))
      setKind(rendererKind(editing))
      setTemplateHtml(editing.renderer.kind === 'template' ? editing.renderer.html : '')
      return
    }
    setDefinitionJson(NEW_DEFINITION_JSON)
    setKind('template')
    setTemplateHtml('')
  }, [editing, open])

  const saveMutation = useMutation({
    mutationFn: (input: OutputDefinitionInput) =>
      editing ? putOutputDefinition(editing.id, input) : createOutputDefinition(input),
  })

  const handleSave = () => {
    setError(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(definitionJson)
    } catch {
      setError('Definition JSON is not valid JSON.')
      return
    }

    const base =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}

    const candidate = {
      ...base,
      id: editing ? editing.id : base.id,
      renderer: kind === 'template' ? { kind: 'template', html: templateHtml } : { kind: 'html' },
    }

    const result = UserOutputDefinitionInputSchema.safeParse(candidate)
    if (!result.success) {
      setError(formatIssues(result.error.issues))
      return
    }

    saveMutation.mutate(result.data, {
      onSuccess: () => {
        onSaved()
        onOpenChange(false)
      },
      onError: (mutationError) => {
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : 'Failed to save the output definition',
        )
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit output definition' : 'New output definition'}</DialogTitle>
          <DialogDescription>
            Define the output metadata, instructions, and the template or HTML used to render it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="definitionJson">Definition JSON</Label>
            <Textarea
              id="definitionJson"
              value={definitionJson}
              onChange={(event) => setDefinitionJson(event.target.value)}
              rows={12}
              className="font-mono md:text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="outputRendererKind">Renderer</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as RendererKind)}>
              <SelectTrigger id="outputRendererKind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="template">Template</SelectItem>
                <SelectItem value="html">Raw HTML</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              The renderer is built from this selector and the template HTML, not from the JSON.
            </p>
          </div>

          {kind === 'template' && (
            <div className="space-y-2">
              <Label htmlFor="outputTemplateHtml">Template HTML</Label>
              <Textarea
                id="outputTemplateHtml"
                value={templateHtml}
                onChange={(event) => setTemplateHtml(event.target.value)}
                rows={10}
                className="font-mono md:text-xs"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
