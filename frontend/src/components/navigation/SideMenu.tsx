/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react'
import { useMobile, usePanelSwipeClose } from '@/hooks/useMobile'
import { useSideMenu } from '@/hooks/useSideMenu'
import { SideMenuContent } from './SideMenuContent'
import { isFullWidthSideMenu, sideMenuWidthCss } from './sideMenuLayout'

const openSideMenuStack: symbol[] = []

function useTrackedWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return width
}

/**
 * CSS offset the app content moves by to reveal the phone side menu.
 *
 * @param enabled Whether the phone layout is active.
 * @returns The side menu width while it is open, or `'0px'`.
 */
export function useSideMenuOffset(enabled = true): string {
  const { isOpen } = useSideMenu()
  const width = useTrackedWindowWidth()
  return enabled && isOpen ? sideMenuWidthCss(width) : '0px'
}

/** Phone side menu overlay, its tap-to-close scrim, and its escape and swipe close handlers. */
export function SideMenu() {
  const isMobile = useMobile()
  const { isOpen, closeMenu } = useSideMenu()
  const windowWidth = useTrackedWindowWidth()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeMenuRef = useRef(closeMenu)

  useEffect(() => {
    closeMenuRef.current = closeMenu
  }, [closeMenu])

  const { bind } = usePanelSwipeClose(closeMenu, { enabled: isMobile && isOpen })

  useEffect(() => {
    if (!isOpen) return undefined
    const cleanup = bind(panelRef.current)
    return () => {
      cleanup?.()
    }
  }, [bind, isOpen])

  useEffect(() => {
    if (!isMobile || !isOpen) return undefined

    const token = Symbol('side-menu')
    openSideMenuStack.push(token)

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || openSideMenuStack.at(-1) !== token) return
      event.preventDefault()
      closeMenuRef.current()
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
      const index = openSideMenuStack.indexOf(token)
      if (index !== -1) openSideMenuStack.splice(index, 1)
    }
  }, [isMobile, isOpen])

  const width = sideMenuWidthCss(windowWidth)

  if (!isMobile || !isOpen) return null

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-background pt-safe"
        style={{ width }}
        data-width={width}
      >
        <SideMenuContent
          variant="overlay"
          fullWidth={isFullWidthSideMenu(windowWidth)}
          onClose={closeMenu}
        />
      </div>
      <button
        type="button"
        aria-label="Dismiss menu"
        onClick={closeMenu}
        className="fixed inset-y-0 right-0 z-40 border-0 bg-black/40 p-0 backdrop-blur-sm"
        style={{ left: width }}
      />
    </>
  )
}
