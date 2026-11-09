/** Viewport width below which the side menu fills the full screen width. */
export const SIDE_MENU_FULL_WIDTH_BELOW_PX = 600

/** Viewport media query at or above which the side menu stops spanning the full width. */
export const SIDE_MENU_WIDE_MEDIA_QUERY = `(min-width: ${SIDE_MENU_FULL_WIDTH_BELOW_PX}px)`

/** True when the side menu spans the full viewport width instead of floating beside the content. */
export function isFullWidthSideMenu(viewportWidth: number): boolean {
  return viewportWidth < SIDE_MENU_FULL_WIDTH_BELOW_PX
}

/** CSS width for the side menu at the given viewport width. */
export function sideMenuWidthCss(viewportWidth: number): string {
  return isFullWidthSideMenu(viewportWidth) ? '100vw' : 'min(80vw, 520px)'
}
