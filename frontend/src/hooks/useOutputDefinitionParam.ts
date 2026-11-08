import { useCallback } from 'react'
import { DEFAULT_OUTPUT_DEFINITION_ID } from '@opencode-manager/shared/schemas'
import { useUrlParams } from './useUrlParams'

/** URL state of the open output definition (`?output=`), defaulting to the built-in definition id. */
export function useOutputDefinitionParam(): [string, (definitionId: string) => void] {
  const { searchParams, updateParams } = useUrlParams()
  const definitionId = searchParams.get('output') ?? DEFAULT_OUTPUT_DEFINITION_ID
  const setDefinitionId = useCallback(
    (next: string) => {
      updateParams((params) => {
        params.set('output', next)
      }, 'replace')
    },
    [updateParams],
  )
  return [definitionId, setDefinitionId]
}
