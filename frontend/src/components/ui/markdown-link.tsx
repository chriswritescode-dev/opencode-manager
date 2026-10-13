import { createContext, useContext } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'react-markdown'
import { getLocalLinkPath, isExternalLink } from '@/lib/markdownLinks'

const MarkdownLinkContext = createContext(false)

/** Returns whether the current subtree is rendered inside a markdown link. */
export function useIsInsideMarkdownLink(): boolean {
  return useContext(MarkdownLinkContext)
}

type MarkdownLinkProps = ComponentPropsWithoutRef<'a'> & ExtraProps & {
  onOpenLocalPath?: (linkPath: string) => void
}

/**
 * Renders a markdown link. Local file links call `onOpenLocalPath` instead of navigating the app,
 * and external http(s) links open in a new tab.
 */
export function MarkdownLink({ href, children, onOpenLocalPath, ...rest }: MarkdownLinkProps) {
  delete (rest as Record<string, unknown>).node
  const localPath = onOpenLocalPath ? getLocalLinkPath(href) : null
  const wrappedChildren = <MarkdownLinkContext.Provider value={true}>{children}</MarkdownLinkContext.Provider>

  if (localPath && onOpenLocalPath) {
    return (
      <a
        href={href}
        {...rest}
        onClick={(event) => {
          event.preventDefault()
          onOpenLocalPath(localPath)
        }}
      >
        {wrappedChildren}
      </a>
    )
  }

  if (isExternalLink(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{wrappedChildren}</a>
  }

  return <a href={href} {...rest}>{wrappedChildren}</a>
}
