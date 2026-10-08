import { useCallback } from 'react'
import { useUrlParams } from './useUrlParams'

function setDialogParams(
  params: URLSearchParams,
  name: string,
  extraParams?: Record<string, string>,
): void {
  params.set('dialog', name)
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value)
    }
  }
}

export function dialogSearch(name: string, extraParams?: Record<string, string>): string {
  const params = new URLSearchParams()
  setDialogParams(params, name, extraParams)
  return `?${params.toString()}`
}

/**
 * Opens a dialog in an existing param set: sets `dialog` to `name`, applies `extraParams`, and clears `mobileTab`.
 */
export function openDialogParams(
  params: URLSearchParams,
  name: string,
  extraParams?: Record<string, string>,
): void {
  setDialogParams(params, name, extraParams)
  params.delete('mobileTab')
}

export function openDialogParam(
  updateParams: ReturnType<typeof useUrlParams>['updateParams'],
  name: string,
  extraParams?: Record<string, string>,
): void {
  updateParams((p) => {
    openDialogParams(p, name, extraParams)
  }, 'push')
}

const NO_OWNED_PARAMS: readonly string[] = []

export function useDialogParam(
  name: string,
  ownedParams: readonly string[] = NO_OWNED_PARAMS,
): [boolean, (open: boolean) => void] {
  const { searchParams, updateParams } = useUrlParams()

  const isOpen = searchParams.get('dialog') === name

  const setOpen = useCallback(
    (open: boolean) => {
      if (open) {
        openDialogParam(updateParams, name)
        return
      }
      updateParams((p) => {
        if (p.get('dialog') !== name) return
        p.delete('dialog')
        for (const param of ownedParams) p.delete(param)
      }, 'replace')
    },
    [updateParams, name, ownedParams],
  )

  return [isOpen, setOpen]
}
