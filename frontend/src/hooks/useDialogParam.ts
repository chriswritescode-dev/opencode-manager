import { useCallback } from 'react'
import { useUrlParams } from './useUrlParams'

export function openDialogParam(
  updateParams: ReturnType<typeof useUrlParams>['updateParams'],
  name: string,
): void {
  updateParams((p) => {
    p.set('dialog', name)
    p.delete('mobileTab')
  }, 'push')
}

export function useDialogParam(name: string): [boolean, (open: boolean) => void] {
  const { searchParams, updateParams } = useUrlParams()

  const isOpen = searchParams.get('dialog') === name

  const setOpen = useCallback(
    (open: boolean) => {
      if (open) {
        openDialogParam(updateParams, name)
        return
      }
      updateParams((p) => {
        if (p.get('dialog') === name) {
          p.delete('dialog')
        }
      }, 'replace')
    },
    [updateParams, name],
  )

  return [isOpen, setOpen]
}
