import { useCallback } from 'react'
import { useUrlParams } from './useUrlParams'

export function useDialogParam(name: string): [boolean, (open: boolean) => void] {
  const { searchParams, updateParams } = useUrlParams()

  const isOpen = searchParams.get('dialog') === name

  const setOpen = useCallback(
    (open: boolean) => {
      updateParams((p) => {
        if (open) {
          p.set('dialog', name)
          p.delete('mobileTab')
        } else if (p.get('dialog') === name) {
          p.delete('dialog')
        }
      }, open ? 'push' : 'replace')
    },
    [updateParams, name],
  )

  return [isOpen, setOpen]
}
