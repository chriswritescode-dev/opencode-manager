import { truncate } from '../cli/utils'
import type { RalphSessionOutput } from '../services/ralph'

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

export function formatSessionOutput(sessionOutput: RalphSessionOutput): string[] {
  const lines: string[] = []
  const costStr = `$${sessionOutput.totalCost.toFixed(4)}`
  const t = sessionOutput.totalTokens
  const tokensStr = `${formatTokens(t.input)} in / ${formatTokens(t.output)} out / ${formatTokens(t.reasoning)} reasoning / ${formatTokens(t.cacheRead)} cache read / ${formatTokens(t.cacheWrite)} cache write`
  lines.push(`  Cost: ${costStr} | Tokens: ${tokensStr}`)

  if (sessionOutput.fileChanges) {
    const fc = sessionOutput.fileChanges
    lines.push(`  Files changed: ${fc.files} (+${fc.additions}/-${fc.deletions} lines)`)
  }

  if (sessionOutput.messages.length > 0) {
    lines.push('')
    lines.push('Recent Activity:')
    for (const msg of sessionOutput.messages) {
      const preview = truncate(msg.text.replace(/\n/g, ' ').trim(), 200)
      lines.push(`  [assistant] ${preview}`)
    }
  }

  return lines
}

export function formatAuditResult(auditResult: string): string[] {
  const auditPreview = truncate(auditResult, 300)
  return ['', 'Last Audit:', `  ${auditPreview}`]
}
