import { describe, it, expect } from 'vitest'
import { SIDE_MENU_FULL_WIDTH_BELOW_PX, isFullWidthSideMenu, sideMenuWidthCss } from './sideMenuLayout'

describe('isFullWidthSideMenu', () => {
  it('is true below the full-width threshold', () => {
    expect(SIDE_MENU_FULL_WIDTH_BELOW_PX).toBe(600)
    expect(isFullWidthSideMenu(599)).toBe(true)
    expect(isFullWidthSideMenu(320)).toBe(true)
    expect(isFullWidthSideMenu(0)).toBe(true)
  })

  it.each([600, 700, 1280])('is false at %s', (viewportWidth) => {
    expect(isFullWidthSideMenu(viewportWidth)).toBe(false)
  })
})

describe('sideMenuWidthCss', () => {
  it('returns the full viewport width below the threshold', () => {
    expect(sideMenuWidthCss(599)).toBe('100vw')
  })

  it.each([600, 700, 1280])('returns the capped floating width at %s', (viewportWidth) => {
    expect(sideMenuWidthCss(viewportWidth)).toBe('min(80vw, 520px)')
  })
})
