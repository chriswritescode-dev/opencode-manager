import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { defaultUrlTransform } from 'react-markdown'
import type { Options, UrlTransform } from 'react-markdown'

const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data'],
  },
}

/**
 * Rehype pipeline shared by every Markdown renderer. Raw HTML is parsed, then sanitized to
 * GitHub's allow-list so scripts, frames and event handlers are stripped from model output and
 * repository files, and highlighting runs last so its classes survive sanitization. The schema
 * additionally allows the `data` protocol on `src` so inline image data URIs survive sanitization.
 */
export const markdownRehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeHighlight,
]

/**
 * URL transform for Markdown renderers. Keeps `data:image/*` sources intact, which react-markdown's
 * default transform strips, and defers every other URL to that default.
 */
export const markdownUrlTransform: UrlTransform = (url, key) => {
  if (key === 'src' && /^data:image\//i.test(url)) {
    return url
  }

  return defaultUrlTransform(url)
}
