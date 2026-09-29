import type { ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'react-markdown'
import { getLocalLinkPath, isExternalLink } from '@/lib/markdownLinks'

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
        {children}
      </a>
    )
  }

  if (isExternalLink(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>
  }

  return <a href={href} {...rest}>{children}</a>
}
