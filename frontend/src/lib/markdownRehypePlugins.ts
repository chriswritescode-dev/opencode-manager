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

export const markdownRehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeHighlight,
]

export const markdownUrlTransform: UrlTransform = (url, key) => {
  if (key === 'src' && /^data:image\//i.test(url)) {
    return url
  }

  return defaultUrlTransform(url)
}
