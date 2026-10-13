import type { ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'react-markdown'
import { InlineImage } from '@/components/ui/inline-image'
import { useIsInsideMarkdownLink } from '@/components/ui/markdown-link'
import { getFileApiUrl } from '@/api/files'
import { getLocalLinkPath } from '@/lib/markdownLinks'

type MarkdownImageProps = ComponentPropsWithoutRef<'img'> & ExtraProps & {
  resolveLocalPath?: (path: string) => string | null
}

/**
 * Renders a markdown image through the inline image viewer. Local file sources, resolved by
 * `resolveLocalPath` or absolute, load through the raw file API; everything else, including
 * `data:image/*` URIs, is rendered unchanged.
 */
export function MarkdownImage({ src, alt, resolveLocalPath }: MarkdownImageProps) {
  const insideLink = useIsInsideMarkdownLink()

  if (typeof src !== 'string' || src === '') {
    return null
  }

  const localPath = getLocalLinkPath(src)
  let imageSrc = src

  if (localPath) {
    const resolvedPath = resolveLocalPath?.(localPath) ?? null
    if (resolvedPath) {
      imageSrc = getFileApiUrl(resolvedPath, { params: { raw: true } })
    } else if (localPath.startsWith('/')) {
      imageSrc = getFileApiUrl(localPath, { params: { raw: true } })
    }
  }

  return <InlineImage src={imageSrc} alt={alt} expandable={!insideLink} />
}
