const THEME_NAME_TOKENS: Record<string, string> = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-foreground)',
  accent: 'var(--color-info)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-destructive)',
  info: 'var(--color-info)',
}

const DEFAULT_AGENT_NAMES = new Set(['plan', 'build', 'docs', 'ask'])

const FALLBACK_COLOR = 'var(--color-muted-foreground)'

function isValidHex(color: string | undefined): boolean {
  if (!color) return false
  return /^#[0-9A-Fa-f]{6}$/.test(color)
}

function resolveAgentColor(agentName: string, apiColor?: string): string {
  if (isValidHex(apiColor) && apiColor) {
    return apiColor
  }

  if (apiColor) {
    const themeToken = THEME_NAME_TOKENS[apiColor.toLowerCase()]
    if (themeToken) {
      return themeToken
    }
  }

  const lookupName = agentName.toLowerCase()
  if (DEFAULT_AGENT_NAMES.has(lookupName)) {
    return `var(--color-agent-${lookupName})`
  }

  return FALLBACK_COLOR
}

export function getAgentStyleVars(
  agentName: string,
  apiColor?: string
): Record<string, string> {
  const color = resolveAgentColor(agentName, apiColor)
  const mix = (percent: number) => `color-mix(in oklab, ${color} ${percent}%, transparent)`

  return {
    '--agent-color': color,
    '--agent-bg': mix(20),
    '--agent-bg-hover': mix(30),
    '--agent-border': mix(60),
    '--agent-border-hover': mix(50),
    '--agent-shadow': mix(20),
    '--agent-shadow-hover': mix(30),
  }
}
