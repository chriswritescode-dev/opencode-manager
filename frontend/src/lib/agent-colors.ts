function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace(/^#/, '')
  if (cleanHex.length !== 6) {
    return null
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(cleanHex)
  if (!result) {
    return null
  }

  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  }
}

const DEFAULT_AGENT_COLORS: Record<string, { light: string; dark: string }> = {
  plan:  { light: '#a753ae', dark: '#edb2f1' },
  build: { light: '#034cff', dark: '#89b5ff' },
  docs:  { light: '#ffb224', dark: '#ffb224' },
  ask:   { light: '#0091ff', dark: '#0091ff' },
}

const FALLBACK_COLOR = { light: '#6b7280', dark: '#9ca3af' }

function isValidHex(color: string | undefined): color is string {
  if (!color) return false
  return /^#[0-9A-Fa-f]{6}$/.test(color)
}

export function getAgentColor(
  agentName: string,
  apiColor?: string
): { light: string; dark: string } {
  if (isValidHex(apiColor)) {
    return { light: apiColor, dark: apiColor }
  }

  const lookupName = agentName.toLowerCase()
  const defaultColor = DEFAULT_AGENT_COLORS[lookupName]

  if (defaultColor) {
    return defaultColor
  }

  return FALLBACK_COLOR
}

export function getAgentStyleVars(
  agentName: string,
  apiColor?: string
): Record<string, string> {
  const colors = getAgentColor(agentName, apiColor)

  const lightRgb = hexToRgb(colors.light)
  const darkRgb = hexToRgb(colors.dark)

  const fallbackLight = FALLBACK_COLOR.light
  const fallbackDark = FALLBACK_COLOR.dark

  const lightVars = lightRgb
    ? {
        r: lightRgb.r,
        g: lightRgb.g,
        b: lightRgb.b,
      }
    : hexToRgb(fallbackLight)!

  const darkVars = darkRgb
    ? {
        r: darkRgb.r,
        g: darkRgb.g,
        b: darkRgb.b,
      }
    : hexToRgb(fallbackDark)!

  return {
    '--agent-color-light': colors.light,
    '--agent-color-dark': colors.dark,
    '--agent-bg-light': `rgba(${lightVars.r}, ${lightVars.g}, ${lightVars.b}, 0.2)`,
    '--agent-bg-dark': `rgba(${darkVars.r}, ${darkVars.g}, ${darkVars.b}, 0.2)`,
    '--agent-bg-hover-light': `rgba(${lightVars.r}, ${lightVars.g}, ${lightVars.b}, 0.3)`,
    '--agent-bg-hover-dark': `rgba(${darkVars.r}, ${darkVars.g}, ${darkVars.b}, 0.3)`,
    '--agent-border-light': `rgba(${lightVars.r}, ${lightVars.g}, ${lightVars.b}, 0.6)`,
    '--agent-border-dark': `rgba(${darkVars.r}, ${darkVars.g}, ${darkVars.b}, 0.6)`,
    '--agent-border-hover-light': `rgba(${lightVars.r}, ${lightVars.g}, ${lightVars.b}, 0.5)`,
    '--agent-border-hover-dark': `rgba(${darkVars.r}, ${darkVars.g}, ${darkVars.b}, 0.5)`,
    '--agent-shadow-light': `rgba(${lightVars.r}, ${lightVars.g}, ${lightVars.b}, 0.2)`,
    '--agent-shadow-dark': `rgba(${darkVars.r}, ${darkVars.g}, ${darkVars.b}, 0.2)`,
    '--agent-shadow-hover-light': `rgba(${lightVars.r}, ${lightVars.g}, ${lightVars.b}, 0.3)`,
    '--agent-shadow-hover-dark': `rgba(${darkVars.r}, ${darkVars.g}, ${darkVars.b}, 0.3)`,
  }
}
