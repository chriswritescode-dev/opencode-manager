import type { ComponentType, ReactNode } from 'react'
import { SandboxedHtmlFrame } from '@/components/ui/sandboxed-html-frame'
import { getFileApiUrl } from '@/api/files'
import type { BuiltinOutputRendererId, OutputDefinition, OutputRecord } from '@opencode-manager/shared/schemas'
import { OutputTemplateFrame } from './OutputTemplateFrame'
import { WalkthroughOutputRenderer } from './renderers/WalkthroughOutputRenderer'

export interface BuiltinOutputRendererProps {
  data: unknown
  onOpenFile?: (path: string, line?: number) => void
  onRefine?: (text: string) => void
}

/** Builtin renderer components keyed by the definition's builtin renderer id. */
const BUILTIN_OUTPUT_RENDERERS: Partial<
  Record<BuiltinOutputRendererId, ComponentType<BuiltinOutputRendererProps>>
> = {
  walkthrough: WalkthroughOutputRenderer,
}

export interface OutputRendererHostProps {
  definition: OutputDefinition
  output: OutputRecord | null
  data: unknown
  reloadKey?: string | number
  onOpenFile?: (path: string, line?: number) => void
  onRefine?: (text: string) => void
}

/** Renders an output through its definition's builtin, HTML, or template renderer. */
export function OutputRendererHost({
  definition,
  output,
  data,
  reloadKey,
  onOpenFile,
  onRefine,
}: OutputRendererHostProps): ReactNode {
  const renderer = definition.renderer

  if (renderer.kind === 'builtin') {
    const Renderer = BUILTIN_OUTPUT_RENDERERS[renderer.id]
    if (!Renderer) {
      return <p className="text-sm text-muted-foreground">This output's renderer is not available.</p>
    }
    return <Renderer key={reloadKey} data={data} onOpenFile={onOpenFile} onRefine={onRefine} />
  }

  if (renderer.kind === 'html') {
    if (!output?.outputDir) return null
    return (
      <SandboxedHtmlFrame
        src={getFileApiUrl(`${output.outputDir}/index.html`, { params: { raw: true } })}
        title={definition.label}
        reloadKey={reloadKey}
        className="min-h-0 flex-1"
      />
    )
  }

  if (renderer.kind === 'template') {
    if (!output?.outputDir) return null
    return (
      <OutputTemplateFrame
        src={getFileApiUrl(`${output.outputDir}/index.html`, { params: { raw: true } })}
        data={data}
        reloadKey={reloadKey}
        onOpenFile={onOpenFile}
        onRefine={definition.generation === 'separateSession' ? onRefine : undefined}
        title={definition.label}
      />
    )
  }
}
