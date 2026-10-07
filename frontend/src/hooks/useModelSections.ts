import { useMemo } from 'react'
import { useProviders } from './useProviders'
import { useOpenCodeDefaultModel, useOpenCodeModelState } from './useModelSelection'
import { buildModelSections, type ModelSection } from '@/lib/modelSections'
import type { OpenCodeModelState, Provider } from '@/api/providers'

const EMPTY_PROVIDERS: Provider[] = []

export interface UseModelSectionsResult {
  providers: Provider[]
  sections: ModelSection[]
  defaultModel: string | null | undefined
  modelState: OpenCodeModelState | undefined
  isLoading: boolean
}

export function useModelSections(
  directory?: string,
  options: { enabled?: boolean } = {},
): UseModelSectionsResult {
  const enabled = options.enabled ?? true
  const { data: catalog, isLoading: catalogLoading } = useProviders(directory, { enabled })
  const { data: modelState, isLoading: modelStateLoading } = useOpenCodeModelState(directory, enabled)
  const { data: defaultModel, isLoading: defaultModelLoading } = useOpenCodeDefaultModel(directory, enabled)

  const providers = catalog?.providers ?? EMPTY_PROVIDERS

  const sections = useMemo(
    () => buildModelSections(providers, modelState, defaultModel),
    [providers, modelState, defaultModel],
  )

  return {
    providers,
    sections,
    defaultModel,
    modelState,
    isLoading: catalogLoading || modelStateLoading || defaultModelLoading,
  }
}
