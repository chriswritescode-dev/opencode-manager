import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import type { Options } from 'react-markdown'

/**
 * Rehype pipeline shared by every Markdown renderer. Raw HTML is parsed, then sanitized to
 * GitHub's allow-list so scripts, frames and event handlers are stripped from model output and
 * repository files, and highlighting runs last so its classes survive sanitization.
 */
export const markdownRehypePlugins: NonNullable<Options['rehypePlugins']> = [rehypeRaw, rehypeSanitize, rehypeHighlight]
