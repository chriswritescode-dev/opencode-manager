import { useCallback, useMemo } from 'react'
import { useModelSelection, useModelStateMutation, type ModelSelectionSession } from './useModelSelection'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'
import { saveOpenCodeModelVariant } from '@/api/providers'
import {
  cycleModelVariant,
  normalizeModelVariant,
  setModelVariant,
} from '@opencode-manager/shared/opencode'

export interface UseVariantsResult {
  availableVariants: string[]
  currentVariant: string | undefined
  setVariant: (variant: string | undefined) => void
  cycleVariant: () => void
  clearVariant: () => void
  hasVariants: boolean
}

interface SaveVariantInput {
  model: ModelSelection
  value: string | undefined
}

export function useVariants(
  directory?: string,
  session?: ModelSelectionSession,
): UseVariantsResult {
  const { model, selection, info } = useModelSelection(directory, session)
  const activeAgent = useModelStore((state) => state.activeAgent)
  const setSessionPick = useModelStore((state) => state.setSessionPick)

  const availableVariants = useMemo(
    () => info?.variants.map((variant) => variant.id).filter((id) => id !== 'default') ?? [],
    [info],
  )

  const currentVariant = selection?.variant

  const saveVariant = useModelStateMutation(
    ({ model, value }: SaveVariantInput) => saveOpenCodeModelVariant(model, value),
    (state, input: SaveVariantInput) => setModelVariant(state, input.model, input.value),
    'Failed to save model variant to backend',
  )

  const setVariant = useCallback(
    (variant: string | undefined) => {
      if (!model) return
      if (session?.id && activeAgent?.id) {
        setSessionPick(session.id, activeAgent.id, { ...model, variant: normalizeModelVariant(variant) })
      }
      saveVariant.mutate({ model, value: variant })
    },
    [activeAgent?.id, model, saveVariant, session?.id, setSessionPick],
  )

  const cycleVariant = useCallback(
    () => setVariant(cycleModelVariant(currentVariant, availableVariants)),
    [availableVariants, currentVariant, setVariant],
  )

  const clearVariant = useCallback(() => setVariant(undefined), [setVariant])

  return {
    availableVariants,
    currentVariant,
    setVariant,
    cycleVariant,
    clearVariant,
    hasVariants: availableVariants.length > 0,
  }
}
