import { createContext, useContext } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'react-markdown'
import { getLocalLinkPath, isExternalLink } from '@/lib/markdownLinks'

const MarkdownLinkContext = createContext(false)

export function useIsInsideMarkdownLink(): boolean {
  return useContext(MarkdownLinkContext)
}

type MarkdownLinkProps = ComponentPropsWithoutRef<'a'> & ExtraProps & {
  onOpenLocalPath?: (linkPath: string) => void
}

export function MarkdownLink({ href, children, onOpenLocalPath, ...rest }: MarkdownLinkProps) {
  const linkProps = { ...rest }
  delete linkProps.node
  const localPath = onOpenLocalPath ? getLocalLinkPath(href) : null
  const wrappedChildren = <MarkdownLinkContext.Provider value={true}>{children}</MarkdownLinkContext.Provider>

  if (localPath && onOpenLocalPath) {
    return (
      <a
        href={href}
        {...linkProps}
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
    return <a href={href} target="_blank" rel="noopener noreferrer" {...linkProps}>{wrappedChildren}</a>
  }

  return <a href={href} {...linkProps}>{wrappedChildren}</a>
}
