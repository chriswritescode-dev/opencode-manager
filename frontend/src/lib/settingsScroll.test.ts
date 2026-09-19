import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isSectionFullyVisible, scrollSectionIntoView } from './settingsScroll'

function buildSection(options: { sectionTop: number; sectionBottom: number; scrollerTop: number; scrollerBottom: number }) {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: options.scrollerBottom - options.scrollerTop, configurable: true })
  scroller.getBoundingClientRect = () => ({
    top: options.scrollerTop,
    bottom: options.scrollerBottom,
  }) as DOMRect

  const section = document.createElement('div')
  section.getBoundingClientRect = () => ({
    top: options.sectionTop,
    bottom: options.sectionBottom,
  }) as DOMRect

  const header = document.createElement('button')
  const scrollIntoView = vi.fn()
  header.scrollIntoView = scrollIntoView

  section.appendChild(header)
  scroller.appendChild(section)
  document.body.appendChild(scroller)

  return { header, scrollIntoView }
}

describe('isSectionFullyVisible', () => {
  it('is true only when the section sits within the scroller bounds', () => {
    expect(isSectionFullyVisible({ top: 40, bottom: 120 }, { top: 0, bottom: 400 })).toBe(true)
    expect(isSectionFullyVisible({ top: 360, bottom: 520 }, { top: 0, bottom: 400 })).toBe(false)
    expect(isSectionFullyVisible({ top: -120, bottom: -20 }, { top: 0, bottom: 400 })).toBe(false)
  })
})

describe('scrollSectionIntoView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('does not scroll when the section is already fully visible', () => {
    const { header, scrollIntoView } = buildSection({ sectionTop: 40, sectionBottom: 120, scrollerTop: 0, scrollerBottom: 400 })

    scrollSectionIntoView(header)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls the header to the top when the section bottom is below the scroll container', () => {
    const { header, scrollIntoView } = buildSection({ sectionTop: 360, sectionBottom: 520, scrollerTop: 0, scrollerBottom: 400 })

    scrollSectionIntoView(header)

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('scrolls the header to the top when the section is above the scroll container', () => {
    const { header, scrollIntoView } = buildSection({ sectionTop: -120, sectionBottom: -20, scrollerTop: 0, scrollerBottom: 400 })

    scrollSectionIntoView(header)

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('ignores a missing header', () => {
    expect(() => scrollSectionIntoView(null)).not.toThrow()
  })
})
