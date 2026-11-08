/** Viewport width below which the side menu fills the full screen width. */
export const SIDE_MENU_FULL_WIDTH_BELOW_PX = 600

/** True when the side menu spans the full viewport width instead of floating beside the content. */
export function isFullWidthSideMenu(viewportWidth: number): boolean {
  return viewportWidth < SIDE_MENU_FULL_WIDTH_BELOW_PX
}

/** CSS width for the side menu at the given viewport width. */
export function sideMenuWidthCss(viewportWidth: number): string {
  return isFullWidthSideMenu(viewportWidth) ? '100vw' : 'min(80vw, 520px)'
}
