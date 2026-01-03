import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CSSProperties } from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const GPU_ACCELERATED_STYLE: CSSProperties = {
  transform: 'translateZ(0)',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
}

export const MODAL_TRANSITION_MS = 300

/**
 * Sanitizes markdown text for TTS playback by removing non-read-aloud symbols
 * Converts markdown into clean, readable text suitable for speech synthesis
 */
export function sanitizeForTTS(text: string): string {
  if (!text) return ''

  let sanitized = text

  // Remove code blocks entirely (not readable for TTS)
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '')

  // Remove inline code, keep content: `code` -> code
  sanitized = sanitized.replace(/`([^`]+)`/g, '$1')

  // Remove markdown images first (before links): ![alt](url) -> alt
  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

  // Remove markdown links, keep display text: [text](url) -> text
  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Remove bold markers: **text** -> text or __text__ -> text
  sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '$1')
  sanitized = sanitized.replace(/__([^_]+)__/g, '$1')

  // Remove italic markers: *text* -> text or _text_ -> text
  sanitized = sanitized.replace(/\*([^*]+)\*/g, '$1')
  sanitized = sanitized.replace(/_([^_]+)_/g, '$1')

  // Remove strikethrough: ~~text~~ -> text
  sanitized = sanitized.replace(/~~([^~]+)~~/g, '$1')

  // Remove headers: ### Header -> Header
  sanitized = sanitized.replace(/^#{1,6}\s+/gm, '')

  // Remove list markers: - item, * item, + item, or 1. item -> item
  sanitized = sanitized.replace(/^\s*[-*+]\s+/gm, '')
  sanitized = sanitized.replace(/^\s*\d+\.\s+/gm, '')

  // Remove blockquotes: > quote -> quote
  sanitized = sanitized.replace(/^>\s+/gm, '')

  // Remove horizontal rules: --- or *** or ___
  sanitized = sanitized.replace(/^(\*\*\*|---|___)\s*$/gm, '')

  // Remove footnote references: [^1] -> remove
  sanitized = sanitized.replace(/\[\^[^\]]+\]/g, '')

  // Remove citation references: [1] or [1,2] -> remove
  sanitized = sanitized.replace(/\[\d+(,\d+)*\]/g, '')

  // Remove HTML tags: <tag> -> remove
  sanitized = sanitized.replace(/<[^>]*>/g, '')

  // Process tables: handle line-by-line for proper cell separation
  const lines = sanitized.split('\n')
  const processedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    
    // Skip table separator rows (only dashes, pipes, equals, spaces)
    if (/^[|\s\-_=]+$/.test(trimmed)) {
      continue
    }

    // Handle table rows (contain pipes)
    if (trimmed.includes('|')) {
      // Remove pipes and multiple spaces
      const cells = trimmed.split('|')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .join(' ')
      if (cells) processedLines.push(cells)
    } else if (trimmed) {
      // Non-table line
      processedLines.push(trimmed)
    }
  }

  sanitized = processedLines.join('\n')

  // Clean up whitespace
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n')
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ')
  sanitized = sanitized.trim()

  // Fix common punctuation spacing issues
  sanitized = sanitized.replace(/\s+([.,!?;:])/g, '$1')

  return sanitized
}
