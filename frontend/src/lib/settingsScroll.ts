interface RectLike {
  top: number
  bottom: number
}

export function isSectionFullyVisible(section: RectLike, scroller: RectLike): boolean {
  return section.top >= scroller.top && section.bottom <= scroller.bottom
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

export function scrollSectionIntoView(header: HTMLElement | null) {
  if (!header) return
  const section = header.parentElement
  if (!section) return
  const scroller = findScrollContainer(section)
  if (scroller && isSectionFullyVisible(section.getBoundingClientRect(), scroller.getBoundingClientRect())) {
    return
  }
  header.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
