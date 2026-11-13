import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CSSProperties } from "react"
import type { Repo } from "@/api/types"
import type { GitBranch } from "@/api/repos"

export { getRepoDisplayName } from '@opencode-manager/shared/utils'

export function getRepoBranchLabel(repo: Pick<Repo, 'currentBranch' | 'branch'>): string | null {
  return repo.currentBranch || repo.branch || null
}

const ORIGIN_REMOTE_PREFIX = 'remotes/origin/'

export function getOriginOnlyBranchNames(branches: Pick<GitBranch, 'name' | 'type'>[]): string[] {
  const localNames = new Set(branches.filter((b) => b.type === 'local').map((b) => b.name))
  const seen = new Set<string>()
  const result: string[] = []

  for (const branch of branches) {
    if (branch.type !== 'remote' || !branch.name.startsWith(ORIGIN_REMOTE_PREFIX)) continue
    const shortName = branch.name.slice(ORIGIN_REMOTE_PREFIX.length)
    if (shortName.length === 0 || shortName === 'HEAD') continue
    if (localNames.has(shortName) || seen.has(shortName)) continue
    seen.add(shortName)
    result.push(shortName)
  }

  return result
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortenPath(path: string, maxSegments = 3): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return '/'
  if (segments.length <= maxSegments) return `/${segments.join('/')}`
  return `/.../${segments.slice(-maxSegments).join('/')}`
}

export function getDirectoryName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

export function randomId(): string {
  if ('crypto' in globalThis && globalThis.crypto.randomUUID !== undefined) {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatShortRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 4) return `${diffWeeks}w ago`
  return `${diffMonths}mo ago`
}

export const GPU_ACCELERATED_STYLE: CSSProperties = {
  transform: 'translateZ(0)',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
}

export const MODAL_TRANSITION_MS = 300

export function sanitizeForTTS(text: string): string {
  if (!text) return ''

  let sanitized = text

  sanitized = sanitized.replace(/```[\s\S]*?```/g, '')

  sanitized = sanitized.replace(/`([^`]+)`/g, '$1')

  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '$1')
  sanitized = sanitized.replace(/__([^_]+)__/g, '$1')

  sanitized = sanitized.replace(/\*([^*]+)\*/g, '$1')
  sanitized = sanitized.replace(/_([^_]+)_/g, '$1')

  sanitized = sanitized.replace(/~~([^~]+)~~/g, '$1')

  sanitized = sanitized.replace(/^#{1,6}\s+/gm, '')

  sanitized = sanitized.replace(/^\s*(?:(?:[-*+]|\d+\.)\s+)?\[[ xX]\]\s+/gm, '')

  sanitized = sanitized.replace(/^\s*[-*+]\s+/gm, '')
  sanitized = sanitized.replace(/^\s*\d+\.\s+/gm, '')

  sanitized = sanitized.replace(/^>\s+/gm, '')

  sanitized = sanitized.replace(/^(\*\*\*|---|___|={3,})\s*$/gm, '')

  sanitized = sanitized.replace(/\[\^[^\]]+\]/g, '')

  sanitized = sanitized.replace(/\[\d+(,\d+)*\]/g, '')

  sanitized = sanitized.replace(/<[^>]*>/g, '')

  const lines = sanitized.split('\n')
  const processedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    
    if (/^[|\s\-_=]+$/.test(trimmed)) {
      continue
    }

    if (trimmed.includes('|')) {
      const cells = trimmed.split('|')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .join(' ')
      if (cells) processedLines.push(cells)
    } else if (trimmed) {
      processedLines.push(trimmed)
    }
  }

  sanitized = processedLines.join('\n')

  sanitized = sanitized.replace(/\n{3,}/g, '\n\n')
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ')
  sanitized = sanitized.trim()

  sanitized = sanitized.replace(/\s+([.,!?;:])/g, '$1')

  return sanitized
}
