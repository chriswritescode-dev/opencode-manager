import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FileText,
  GitCompare,
  LayoutDashboard,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  Table,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getFileApiUrl } from '@/api/files'
import {
  useCancelOutput,
  useGenerateOutput,
  useOutputData,
  useOutputDefinitions,
  useOutputState,
  usePromoteOutputDefinition,
  useRefineOutput,
} from '@/hooks/useOutputs'
import {
  ChangeSourceSchema,
  DEFAULT_CHANGE_SOURCE,
  OUTPUT_LIMITS,
  describeChangeSource,
  outputParamsKey,
  resolveOutputParams,
} from '@opencode-manager/shared/schemas'
import type {
  ChangeSource,
  OutputDefinition,
  OutputIcon,
  OutputParams,
} from '@opencode-manager/shared/schemas'
import { formatOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import type { ModelRef } from '@opencode-manager/shared/opencode'
import { OutputParamsForm } from './OutputParamsForm'
import { OutputRendererHost } from './OutputRendererHost'
import { PromoteOutputDialog } from './PromoteOutputDialog'

const OUTPUT_ICON_COMPONENTS: Record<OutputIcon, LucideIcon> = {
  BookOpen,
  FileText,
  ListChecks,
  ShieldAlert,
  Table,
  BarChart3,
  LayoutDashboard,
  Sparkles,
  GitCompare,
  ClipboardList,
}

interface OutputErrorLike {
  message?: string
  code?: string
}

function outputErrorCode(error: unknown): string | undefined {
  return (error as OutputErrorLike | null)?.code
}

function outputErrorMessage(error: unknown): string {
  return (error as OutputErrorLike | null)?.message || 'Failed to save the output'
}

function isNoChangesCode(code: string | undefined): boolean {
  return code === 'OUTPUT_NO_CHANGES' || code === 'OUTPUT_NO_TEXT_CHANGES'
}

function generationErrorMessage(error: unknown): string {
  const code = outputErrorCode(error)
  const message = (error as OutputErrorLike | null)?.message
  if (isNoChangesCode(code)) {
    return message || 'This session has no text changes to walk through'
  }
  return message || 'Failed to load the output'
}

function readChangeSource(definition: OutputDefinition | null, params: OutputParams): ChangeSource {
  const field = definition?.params.find((candidate) => candidate.type === 'changeSource')
  if (!field) return DEFAULT_CHANGE_SOURCE
  const parsed = ChangeSourceSchema.safeParse(params[field.name])
  return parsed.success ? parsed.data : DEFAULT_CHANGE_SOURCE
}

function resolveDefinitionParams(
  definition: OutputDefinition | null,
  params: OutputParams,
): { params: OutputParams; valid: boolean } {
  if (!definition) return { params, valid: true }
  try {
    return { params: resolveOutputParams(definition, params), valid: true }
  } catch {
    return { params, valid: false }
  }
}

export interface OutputOpenRequest {
  sessionId: string
  definitionId: string
  params?: OutputParams
}

export interface OutputsPanelProps {
  sessionId: string
  definitionId: string
  onDefinitionChange: (definitionId: string) => void
  request?: OutputOpenRequest
  model?: ModelRef | null
  onOpenSession?: (sessionId: string) => void
  onOpenFile?: (path: string, line?: number) => void
}

/** Runs and displays one of a session's outputs, including its params, generation, and refinement controls. */
export function OutputsPanel({
  sessionId,
  definitionId,
  onDefinitionChange,
  request,
  model,
  onOpenSession,
  onOpenFile,
}: OutputsPanelProps): ReactNode {
  const [params, setParams] = useState<OutputParams>({})
  const [paramsPending, setParamsPending] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [reload, setReload] = useState(0)
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [promoteError, setPromoteError] = useState<string | null>(null)
  const appliedRequest = useRef<OutputOpenRequest | null>(null)

  const definitionsQuery = useOutputDefinitions(sessionId)
  const definitions = definitionsQuery.data ?? []
  const listedDefinition = definitions.find((entry) => entry.id === definitionId) ?? null
  const listedResolution = resolveDefinitionParams(listedDefinition, params)
  const stateQuery = useOutputState(
    sessionId,
    listedDefinition?.id,
    listedResolution.params,
    listedDefinition !== null,
  )
  const state = stateQuery.data
  const definition = listedDefinition ?? state?.definition ?? null
  const resolution =
    definition === listedDefinition ? listedResolution : resolveDefinitionParams(definition, params)
  const resolvedParams = resolution.params
  const paramsValid = resolution.valid
  const paramsKey = outputParamsKey(resolvedParams)

  const generate = useGenerateOutput(sessionId, definitionId, resolvedParams)
  const refine = useRefineOutput(sessionId, definitionId, resolvedParams)
  const cancel = useCancelOutput(sessionId, definitionId, resolvedParams)
  const promote = usePromoteOutputDefinition(sessionId)
  const resetGenerate = generate.reset
  const resetRefine = refine.reset

  const output = state?.output ?? null
  const published = output?.publishedAt != null && output?.outputDir != null
  const generating = generate.isPending || refine.isPending || (state?.generating ?? false)
  const running = refine.isPending || (state?.running ?? false)
  const generationError =
    generate.error ??
    refine.error ??
    stateQuery.error ??
    (generating ? null : state?.error ?? null)
  const source = readChangeSource(definition, resolvedParams)
  const labelLower = definition?.label.toLowerCase() ?? 'output'
  const isCurrentSession = definition?.generation === 'currentSession'
  const outputData = useOutputData(definition?.renderer.kind === 'html' ? null : output)
  const modelRequest = model ? { model: formatOpenCodeModelRef(model) } : {}

  useEffect(() => {
    setParams({})
    setParamsPending(false)
    setRefineText('')
    setReload(0)
    setPromoteError(null)
  }, [definitionId])

  useEffect(() => {
    if (!request || request === appliedRequest.current) return
    if (request.definitionId !== definitionId) {
      onDefinitionChange(request.definitionId)
      return
    }
    appliedRequest.current = request
    setParams(request.params ?? {})
  }, [request, definitionId, onDefinitionChange])

  useEffect(() => {
    resetGenerate()
    resetRefine()
  }, [definitionId, paramsKey, sessionId, resetGenerate, resetRefine])

  const saveAsGlobal = async (replace: boolean): Promise<void> => {
    if (!definition) return
    setPromoteError(null)
    try {
      await promote.mutateAsync(replace ? { id: definition.id, replace: true } : { id: definition.id })
      setReplaceDialogOpen(false)
    } catch (error) {
      if (outputErrorCode(error) === 'OUTPUT_DEFINITION_EXISTS' && !replace) {
        setReplaceDialogOpen(true)
        return
      }
      setPromoteError(outputErrorMessage(error))
    }
  }

  const generateOutput = () => generate.mutate(modelRequest)
  const regenerateOutput = () => generate.mutate({ ...modelRequest, regenerate: true })

  const openGeneratorSession =
    output?.generatorSessionId && onOpenSession
      ? () => onOpenSession(output.generatorSessionId!)
      : null

  const openInNewTabUrl =
    published && output?.outputDir
      ? getFileApiUrl(`${output.outputDir}/index.html`, { params: { raw: true } })
      : null

  const submitRefine = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = refineText.trim()
    if (text.length === 0 || refine.isPending) return
    refine.mutate(text)
    setRefineText('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <Select value={definitionId} onValueChange={onDefinitionChange}>
          <SelectTrigger aria-label="Output definition" className="w-auto min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {definitions.map((entry) => {
              const Icon = OUTPUT_ICON_COMPONENTS[entry.icon]
              return (
                <SelectItem key={entry.id} value={entry.id}>
                  <Icon className="h-3.5 w-3.5" />
                  <span>{entry.label}</span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>

        {definition ? (
          <OutputParamsForm
            definition={definition}
            params={params}
            onChange={setParams}
            onPendingChange={setParamsPending}
          />
        ) : null}

        {definition?.generation === 'separateSession' ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={generateOutput}
              disabled={generating || paramsPending || !paramsValid}
            >
              Generate {labelLower}
            </Button>
            {published ? (
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={`Regenerate ${labelLower}`}
                onClick={regenerateOutput}
                disabled={generating || paramsPending || !paramsValid}
              >
                <RefreshCw className={generating ? 'animate-spin' : undefined} />
              </Button>
            ) : null}
            {generating || running ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Stop generating ${labelLower}`}
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                <Square className="h-3.5 w-3.5" />
                {cancel.isPending ? 'Stopping…' : 'Stop'}
              </Button>
            ) : null}
          </>
        ) : null}

        {definition?.origin === 'session' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveAsGlobal(false)}
            disabled={promote.isPending}
          >
            Save as global
          </Button>
        ) : null}

        {refine.isPending ? (
          <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
            Refining…
          </span>
        ) : null}

        {promoteError ? (
          <p role="alert" className="text-sm text-destructive">
            {promoteError}
          </p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {paramsPending ? (
          <p className="text-sm text-muted-foreground">Enter a pull request number</p>
        ) : (
          <>
            {generationError && !(state?.hasInput === false && !generating && !published) ? (
              <p className="text-sm text-destructive">{generationErrorMessage(generationError)}</p>
            ) : null}

            {state?.stale && !generating && !isCurrentSession ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="text-sm text-warning">
                  Changes have been updated since this {labelLower} was generated
                </p>
                <Button variant="outline" size="sm" onClick={generateOutput}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Update {labelLower}
                </Button>
              </div>
            ) : null}

            {stateQuery.isLoading && !output && !generating ? (
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                Loading the output…
              </p>
            ) : null}

            {isCurrentSession && !stateQuery.isLoading && !published && !generating ? (
              <p className="text-sm text-muted-foreground">
                Ask the agent in this chat to publish it
              </p>
            ) : null}

            {definition && !isCurrentSession && !stateQuery.isLoading && !published && !generating ? (
              state?.hasInput === false ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {source.kind === 'session' ? 'No changes in this session' : 'No changes to walk through'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    A walkthrough covers changed files. Change something, then generate one.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Build a {labelLower} of {describeChangeSource(source)}.
                </p>
              )
            ) : null}

            {generating && !published ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
                <span role="status" aria-live="polite">
                  Building the {labelLower} in a separate session…
                </span>
                {openGeneratorSession ? (
                  <Button variant="outline" size="sm" className="ml-auto" onClick={openGeneratorSession}>
                    Open {labelLower} session
                  </Button>
                ) : null}
              </div>
            ) : null}

            {published && definition && output ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReload((value) => value + 1)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reload
                  </Button>
                  {definition.renderer.kind !== 'builtin' && openInNewTabUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={openInNewTabUrl} target="_blank" rel="noreferrer">
                        Open in new tab
                      </a>
                    </Button>
                  ) : null}
                  {openGeneratorSession ? (
                    <Button variant="outline" size="sm" onClick={openGeneratorSession}>
                      Open {labelLower} session
                    </Button>
                  ) : null}
                  {generating || running ? (
                    <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
                      Refining…
                    </span>
                  ) : null}
                </div>
                <OutputRendererHost
                  definition={definition}
                  output={output}
                  data={outputData.data ?? null}
                  reloadKey={`${output.publishedAt}:${reload}`}
                  onOpenFile={onOpenFile}
                  onRefine={isCurrentSession ? undefined : (text) => refine.mutate(text)}
                />
              </div>
            ) : null}

            {published && !isCurrentSession && !generating && !running ? (
              <form className="space-y-2" onSubmit={submitRefine}>
                <Textarea
                  aria-label={`Refine ${labelLower}`}
                  placeholder={`Ask for a change to the ${labelLower}`}
                  maxLength={OUTPUT_LIMITS.REFINE_MAX_CHARS}
                  value={refineText}
                  onChange={(event) => setRefineText(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={refineText.trim().length === 0 || refine.isPending}
                  >
                    {refine.isPending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        )}
      </div>

      <PromoteOutputDialog
        open={replaceDialogOpen}
        definitionId={definition?.id ?? definitionId}
        pending={promote.isPending}
        error={promoteError}
        onOpenChange={setReplaceDialogOpen}
        onCancel={() => setReplaceDialogOpen(false)}
        onConfirm={() => void saveAsGlobal(true)}
      />
    </div>
  )
}
